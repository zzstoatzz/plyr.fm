---
description: Multi-horizon traffic & performance report (24h / 7d / 30d) drawing on Logfire (app-server view) and the Cloudflare API MCP (edge view)
argument-hint: [optional: single horizon like "7d" or "30d", or a specific question]
---

# traffic-overview

Report how plyr.fm production has been going across multiple timescales. Two complementary lenses:

- **Logfire** = inside-the-app view: per-route p95/p99, error breakdowns, user identity, exception types.
- **Cloudflare edge** = outside-the-app view: total requests, unique visitors, bytes, cache hit %, threats blocked, country split. Sees the requests that never hit the origin.

Default: emit a side-by-side multi-horizon summary. If the user asks for a single horizon, focus there.

## horizons & tools

| horizon | Logfire (`mcp__logfire__query_run`) | Cloudflare (`mcp__plugin_cloudflare_cloudflare-api__execute`) |
|---|---|---|
| 24h | ✅ | ✅ |
| 7d  | ✅ | ✅ |
| 14d | ✅ (single-shot — max window) | ✅ |
| 30d | ⚠️ chunk into ≥3 14d windows | ✅ (CF retention ceiling) |
| 90d / 180d | ❌ infeasible (too many chunks) | ❌ CF zone analytics retention is **~30 days** even on paid plans for httpRequests1dGroups — `first_date` returns ~30d ago no matter what `date_geq` you pass |

If the user explicitly asks for 90d or 180d, say so explicitly: that data isn't accessible from the tools we have. Don't fabricate or guess.

## prerequisites

- **Logfire MCP**: auto-available. Use `project: "plyr-fm"` on every `query_run` call.
- **Cloudflare API MCP**: requires the user to have run `/mcp` to authenticate `plugin:cloudflare:cloudflare-api`. If `cloudflare-api__execute` isn't available, prompt the user to run `/mcp` — **do not** call `authenticate` directly (see memory: don't initiate MCP auth flows yourself).

The CF MCP pre-sets `accountId` to `3e9ba01cd687b3c4d29033908177072e` (N8@zzstoatzz.io's account, where plyr.fm lives). The plyr.fm zone ID is `2bfcb9ffe7847604e9febbb62d9649a3`.

## Logfire queries (the SQL pieces)

### Overall stats (any horizon ≤14d)

```sql
SELECT
  COUNT(*) as total_requests,
  COUNT(DISTINCT attributes->>'user.did') as unique_users,
  COUNT(*) FILTER (WHERE http_response_status_code >= 500) as server_errors,
  COUNT(*) FILTER (WHERE http_response_status_code >= 400 AND http_response_status_code < 500) as client_errors,
  COUNT(*) FILTER (WHERE http_response_status_code = 429) as rate_limited,
  ROUND((approx_percentile_cont(duration, 0.50) * 1000)::numeric, 1) as p50_ms,
  ROUND((approx_percentile_cont(duration, 0.95) * 1000)::numeric, 1) as p95_ms,
  ROUND((approx_percentile_cont(duration, 0.99) * 1000)::numeric, 1) as p99_ms
FROM records
WHERE deployment_environment = 'production'
  AND kind = 'span'
  AND http_method IS NOT NULL
  AND http_route != '/health'
```

### Day-by-day breakdown

```sql
SELECT
  date_trunc('day', start_timestamp) as day,
  COUNT(*) as requests,
  COUNT(DISTINCT attributes->>'user.did') as users,
  COUNT(*) FILTER (WHERE http_response_status_code >= 500) as err_5xx,
  COUNT(*) FILTER (WHERE http_response_status_code = 429) as r_429,
  ROUND((approx_percentile_cont(duration, 0.95) * 1000)::numeric, 1) as p95_ms
FROM records
WHERE deployment_environment = 'production'
  AND kind = 'span'
  AND http_method IS NOT NULL
  AND http_route != '/health'
GROUP BY date_trunc('day', start_timestamp)
ORDER BY day DESC
```

### Top routes

```sql
SELECT
  http_route,
  COUNT(*) as req,
  ROUND((approx_percentile_cont(duration, 0.95) * 1000)::numeric, 0) as p95_ms,
  COUNT(*) FILTER (WHERE http_response_status_code >= 500) as err_5xx,
  COUNT(*) FILTER (WHERE http_response_status_code = 429) as r_429
FROM records
WHERE deployment_environment = 'production'
  AND kind = 'span'
  AND http_route IS NOT NULL
GROUP BY http_route
ORDER BY req DESC
LIMIT 15
```

## Cloudflare query (the JS piece)

Call `mcp__plugin_cloudflare_cloudflare-api__execute` with this code, parameterizing `days`:

```js
async () => {
  const ZONE = "2bfcb9ffe7847604e9febbb62d9649a3";
  const days = /* fill in */;
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const r = await cloudflare.request({
    method: "POST",
    path: "/graphql",
    body: {
      query: `query { viewer { zones(filter: {zoneTag: "${ZONE}"}) {
        httpRequests1dGroups(filter: {date_geq: "${since}"}, orderBy: [date_ASC], limit: 200) {
          dimensions { date }
          sum { requests pageViews bytes cachedBytes threats }
          uniq { uniques }
        }
      } } }`
    }
  });
  return r.result?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
}
```

Aggregate client-side: sum `requests` / `pageViews` / `bytes` / `cachedBytes` / `threats`; sum `uniques` as a naive overcounting upper bound (CF doesn't expose deduped uniques across days via this endpoint).

## rough edges (don't relearn each invocation)

1. **CF GraphQL response is unwrapped** — the MCP returns `r.result.viewer.zones`, NOT `r.result.data.viewer.zones`. (Standard GraphQL responses are wrapped in `data:`; the CF MCP strips that envelope.) If you see "0 days returned" but expect data, this is almost certainly the bug.

2. **Use `date_geq`, not `date_gt`** — `date_gt` of "today minus N" silently skips the inclusive boundary day and can return empty results when N is small.

3. **CF zone analytics retention ≈ 30 days** — empirically confirmed: querying for 90 days returns ~34 days starting from `first_date: ~30d ago`. The `limit: 100` in `scripts/cf_analytics.py` was bumped to 200 in PR #1427, but the real ceiling is CF-side retention, not the limit.

4. **Logfire MCP caps each query at a 14-day window** — `Time range N days exceeds max 14 days`. For 30d via Logfire, chunk into ≥3 separate queries. For ≥30d, CF is the better fit (when within its retention window).

5. **`/health` is ~60% of Logfire request counts** — filter it (`http_route != '/health'`) for any "real" traffic metric. Leave it in only when counting overall server load.

6. **DataFusion quirks** —
   - `GROUP BY` needs the expression verbatim, not by alias: `GROUP BY date_trunc('day', start_timestamp)`, NOT `GROUP BY day`.
   - JSONB uses `->` / `->>` (Postgres-flavored).
   - `approx_percentile_cont(duration, 0.95) * 1000` gives p95 in ms (`duration` is in seconds).

7. **`service_name` is `plyr-api` for all environments** — filter by `deployment_environment` (top-level column), never `service_name`. See `docs/internal/tools/logfire.md`.

8. **Cloudflare API MCP needs OAuth via `/mcp`** — if `cloudflare-api__execute` is unavailable, prompt the user to run `/mcp` themselves. Do not call the server's `authenticate` tool.

## what to report

For each horizon, three things:

1. **The numbers** (side-by-side where available): Logfire app-server view (requests, users, 4xx/5xx/429, p50/p95/p99) and Cloudflare edge view (total requests, page views, GB transferred, cache hit %, threats).
2. **The shape**: day-by-day trend (Logfire for ≤7d, CF for 7-30d). Flag any day that breaks the band (>2× the median for errors or p95).
3. **One concrete thing worth knowing**: top error route, slowest route, notable spike, or correlation (e.g., "the 293 rate-limited on 05-16 maps to the now-playing burst bug, fixed in #1426").

Don't dump every column. The user wants the read, not the raw.

## tone

- Lead with the punchline (healthy / one concern / multiple concerns).
- Concrete numbers, not adjectives. "p95 jumped from 95ms to 314ms on 05-16" beats "performance was slow."
- When 90d/180d is requested, name the retention ceiling — never fabricate long-horizon numbers.
