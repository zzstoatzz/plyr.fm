---
description: Multi-horizon traffic & performance report (24h / 7d / 30d / 90d / 180d) drawing on Logfire and Cloudflare analytics
argument-hint: [optional: single horizon like "7d" or "30d", or specific question like "5xx breakdown"]
---

# traffic-overview

Report how plyr.fm production has been going over a range of timescales. By default emit a multi-horizon summary; if the user asks for a single horizon, focus there.

## horizons & which tool serves them

| horizon | tool | why |
|---|---|---|
| 24h, 7d | Logfire | rich SQL — per-route p95/p99, per-user, error breakdown |
| 14d | Logfire | maximum single-query window — see "rough edges" |
| 30d, 90d, 180d | Cloudflare (`scripts/cf_analytics.py`) | edge-level aggregates over long horizons |

For Logfire-served horizons, use the `mcp__logfire__query_run` tool with `project: "plyr-fm"`. For CF, run the script:

```bash
uv run scripts/cf_analytics.py --days 30
uv run scripts/cf_analytics.py --days 90
uv run scripts/cf_analytics.py --days 180
```

## rough edges (learn these once, don't relearn each invocation)

1. **Logfire MCP caps each query at a 14-day window.** Trying `start_timestamp` more than 14 days before `end_timestamp` errors out with `Time range N days exceeds max 14 days`. For 30d via Logfire, chunk into ≥3 separate queries and sum client-side. For 90d/180d, use Cloudflare instead.

2. **`scripts/cf_analytics.py` requires env vars not in any `.env` file checked into the repo:**
   - `SCRIPT_CF_API_TOKEN` — needs Analytics:Read at the zone level
   - `CF_ZONE_ID` — the plyr.fm zone tag
   - `CF_ACCOUNT_ID` — the personal-account ID (`3e9ba01cd687b3c4d29033908177072e`, per memory)

   If `uv run scripts/cf_analytics.py --days 7` errors with `script_cf_api_token Field required`, the token isn't set. Ask the user where they keep it (1Password / shell rc / temporary paste) before claiming the long-horizon data is unavailable — don't fabricate numbers from training data.

3. **`httpRequests1dGroups` query in `cf_analytics.py` has `limit: 100`.** As of 2026-05-22 this was bumped to 200 so 180d works in one shot. If you need ≥200 days, paginate or bump again.

4. **`/health` dominates request counts** (~60% of total). Almost always worth filtering it out for "real" traffic metrics — `WHERE http_route != '/health'`. Leave it in only when counting overall server load.

5. **DataFusion quirks:**
   - Expressions in `GROUP BY` must be repeated verbatim, not aliased — `GROUP BY date_trunc('day', start_timestamp)`, NOT `GROUP BY day`.
   - JSONB access uses `->` / `->>` (Postgres-flavored).
   - `approx_percentile_cont(duration, 0.95) * 1000` gives p95 in ms (duration is in seconds).

6. **`service_name` is `plyr-api` everywhere.** Filter environments with `deployment_environment` (top-level column), never `service_name`. See `docs/internal/tools/logfire.md`.

## standard short-horizon query (24h / 7d / 14d)

For each Logfire-served horizon, run two queries:

### Overall stats

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

### Day-by-day breakdown (for ≥3-day horizons)

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

### Top routes by traffic (sanity check + perf hotspots)

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

## what to report

For each horizon, three things:

1. **The numbers**: requests, unique users, 4xx/5xx/429 counts, p50/p95/p99.
2. **The shape**: day-by-day trend. Flag any day that breaks the band (>2× the median for errors or p95).
3. **One concrete thing worth knowing**: top error route, slowest route, or notable event correlation (e.g., "the 293 rate-limited on 05-16 maps to the now-playing burst bug, now fixed in #1426").

Don't dump every column. The user wants the read, not the raw.

## tone

- Lead with the punchline (healthy / one concern / multiple concerns).
- Use concrete numbers, not adjectives. "p95 jumped from 95ms to 314ms on 05-16" beats "performance was slow."
- When CF data is unavailable because the token isn't set, say so explicitly — never fabricate long-horizon numbers from training data.
