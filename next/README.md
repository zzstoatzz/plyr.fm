# next

everything for the next plyr.fm lives here, and runs alongside the legacy app
(`backend/`, `frontend/`, `services/`) until cutover, when this folder's
contents move up to the top level.

| path | what | deploys to |
|---|---|---|
| `backend/` | zig appview: read-only API, ingester, projections | fly `plyr-api-zig-canary` (api.next.plyr.fm) via `deploy-next.yml` |
| `web/` | sveltekit web client; writes go straight to the user's PDS | cloudflare pages `plyr-fm-next` (next.plyr.fm) via `deploy-web-next.yml` |
| `services/audio/` | cloudflare worker + R2 audio mirror | `wrangler deploy` |

planned:

- `sdk/`: in-repo SDK for the new API (replaces the separate plyr-python-client repo), generated from the same contract the backend serves.
- `mcp/`: MCP server built on the SDK.
- `app/`: native client following bluesky's social-app approach (expo / react native, one codebase for ios, android and web).

rules while next and legacy coexist: nothing here writes to prod, publishes
lexicons, or uses `fm.plyr.*` collections other than the dev/stg NSIDs.
