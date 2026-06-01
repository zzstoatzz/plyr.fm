---
description: Multi-horizon traffic & performance report (24h / 7d / 30d) — Cloudflare edge + Logfire app-server, coupled in one script
argument-hint: [optional: single horizon like "7d" or a specific question]
---

# traffic-overview

Two lenses on the same days:
- **Cloudflare edge** = outside-the-app: total requests, bandwidth, cache %, unique visitors, threats — sees anonymous CDN traffic that never reaches origin.
- **Logfire app** = inside-the-app: authenticated requests, distinct signed-in users, uploads, p95/p99, errors, user identity.

The coupling is the point: the edge serves ~2–3× origin's request count (cache absorbs the rest), and peak unique visitors run ~60× signed-in users (most listening is logged-out). Neither lens shows that gap alone.

## default path: the script

```
uv run scripts/traffic_report.py            # last 7 days
uv run scripts/traffic_report.py -d 1        # last 24h
uv run scripts/traffic_report.py -d 30       # last 30 days (edge retention cap)
```

Renders a coupled summary table + terminal charts (plotext) for any horizon: two overlay line charts (edge-total vs app-origin requests/day; edge-visitors vs signed-in-users/day), plus edge bandwidth, cache-hit %, uploads, and p95 per day. **The ANSI charts render in the user's terminal — don't try to reproduce them in text; extract the summary numbers and narrate the shape.**

To pull just the summary figures (strip ANSI): `... 2>&1 | sed -n '/summary/,/└/p' | sed 's/\x1b\[[0-9;]*m//g'`.

### credentials (.env, gitignored)
- `SCRIPT_CF_API_TOKEN` — Cloudflare token with **Zone → Analytics → Read** on the plyr.fm zone. The older script token only had account/RUM read; if zone analytics 403s (`does not have permission 'com.cloudflare.api.account.zone.analytics.read'`), ask the user to add that permission to the token or mint a new one.
- `LOGFIRE_READ_API_TOKEN` — a Logfire **read** token for the plyr-fm project (Logfire dashboard → project settings → read tokens). Distinct from the write token the backend uses.

Each lens degrades independently — a missing credential or out-of-retention horizon skips that lens with a note instead of failing the whole report. So a partial run still tells you which credential to fix.

## horizons — hard ceilings (the script handles these; respect them in any manual query too)

| horizon | Logfire | Cloudflare |
|---|---|---|
| 24h–7d | ✅ | ✅ |
| 14d | ✅ (max single-query window) | ✅ |
| 30d | ✅ script auto-chunks into 14+14+2 | ✅ |
| **>30d** | ❌ too many chunks | ❌ **edge retention ≈30d** — querying 180d returns ~34 days |

If asked for 90d/180d: say the data isn't accessible. Don't fabricate.

## fallback: query the sources directly

Use these only if the script is unavailable or you need a cut it doesn't render (e.g. top error route, per-country, a specific trace). The script encodes the same queries — prefer it.

### Logfire (≤14d per query, pass `project: "plyr-fm"`)

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

### Cloudflare edge (via the `mcp__plugin_cloudflare_cloudflare-api__execute` MCP)

The MCP is OAuth'd and must be on the **personal** account (`3e9ba01cd687b3c4d29033908177072e`), where plyr.fm lives — not the work/prefect one, or zone queries return `not authorized for that account`. zone ID: `2bfcb9ffe7847604e9febbb62d9649a3`. If unavailable, ask the user to run `/mcp` (don't call `__authenticate` yourself — see `feedback_mcp_auth.md`).

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
4. **Logfire 14d cap** — `Time range N days exceeds max 14 days`. The script chunks; a manual query must not exceed it.
5. **`approx_percentile_cont(duration, 0.95) * 1000`** = p95 in ms (duration is seconds).
6. **`service_name = 'plyr-api'` for all envs** — filter by `deployment_environment`, never `service_name`.
7. **Two different denominators** — CF "unique visitors" is a unique-IP estimate; Logfire "users" is DID-tagged auth'd activity. The gap between them is signal (logged-out reach), not an error.

## what to report

Lead with the punchline (healthy / one concern / multiple concerns), then concrete numbers — not adjectives. For each horizon: the coupled figures (edge + app side by side), the shape (day-by-day, flag >2× median outliers), and one concrete thing (top error route, slowest endpoint, spike correlation, the origin-vs-edge gap). Always surface the edge-vs-origin and visitors-vs-signed-in gaps — they're the reason both lenses exist.
