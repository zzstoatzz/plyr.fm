---
description: Multi-horizon traffic & performance report (24h / 7d / 30d) — Logfire (app-server) and Cloudflare API MCP (edge)
argument-hint: [optional: single horizon like "7d" or a specific question]
---

# traffic-overview

Two lenses:
- **Logfire** = inside-the-app: per-route p95/p99, errors, user identity
- **Cloudflare edge** = outside-the-app: total requests, cache %, bytes, threats — sees requests that never hit origin

## horizons (don't exceed these — both tools have hard ceilings)

| horizon | Logfire | Cloudflare |
|---|---|---|
| 24h–7d | ✅ | ✅ |
| 14d | ✅ (max single-query window) | ✅ |
| 30d | ⚠ chunk into 3× 14d queries | ✅ |
| **>30d** | ❌ too many chunks | ❌ **CF retention ≈30d** — querying 180d returns ~34 days |

If user asks for 90d/180d: say the data isn't accessible. Don't fabricate.

## prerequisites

- **Logfire**: pass `project: "plyr-fm"` to every `mcp__logfire__query_run` call.
- **CF API MCP**: if `mcp__plugin_cloudflare_cloudflare-api__execute` is unavailable, ask user to run `/mcp` to authenticate `plugin:cloudflare:cloudflare-api`. Do NOT call `__authenticate` yourself (see `feedback_mcp_auth.md`).
- plyr.fm zone ID: `2bfcb9ffe7847604e9febbb62d9649a3` (account `3e9ba01cd687b3c4d29033908177072e` is pre-set in the MCP).

## Logfire query (≤14d)

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
  AND http_route != '/health'  -- ~60% of requests; exclude for "real" traffic
```

For day-by-day or top-route breakdowns, swap the SELECT but keep the WHERE. `GROUP BY date_trunc('day', start_timestamp)` — the expression verbatim, not by alias.

## Cloudflare query (any horizon up to 30d)

```js
async () => {
  const ZONE = "2bfcb9ffe7847604e9febbb62d9649a3";
  const days = /* fill in */;
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const r = await cloudflare.request({
    method: "POST",
    path: "/graphql",
    body: { query: `query { viewer { zones(filter: {zoneTag: "${ZONE}"}) {
      httpRequests1dGroups(filter: {date_geq: "${since}"}, orderBy: [date_ASC], limit: 200) {
        dimensions { date }
        sum { requests pageViews bytes cachedBytes threats }
        uniq { uniques }
      }
    } } }` }
  });
  return r.result?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
}
```

## gotchas (these will silently bite you)

1. **CF GraphQL is unwrapped** — `r.result.viewer.zones`, NOT `r.result.data.viewer.zones`. Miss this → silent empty result.
2. **`date_geq`, not `date_gt`** — `date_gt` skips the boundary day.
3. **CF retention ≈ 30 days** — `limit:200` doesn't help past that. Verified empirically.
4. **Logfire 14d cap** — `Time range N days exceeds max 14 days`.
5. **`approx_percentile_cont(duration, 0.95) * 1000`** = p95 in ms (duration is seconds).
6. **`service_name = 'plyr-api'` for all envs** — filter by `deployment_environment`, never `service_name`.

## what to report

For each horizon: numbers (side-by-side Logfire + CF), shape (day-by-day, flag >2× median outliers), one concrete thing (top error route, slowest endpoint, spike correlation). Lead with the punchline (healthy / one concern / multiple concerns). Concrete numbers, not adjectives.
