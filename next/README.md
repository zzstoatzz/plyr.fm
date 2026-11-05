# next

everything for the next plyr.fm lives here, and runs alongside the legacy app
(`backend/`, `frontend/`, `services/`) until cutover, when this folder's
contents move up to the top level.

The [rewrite progress and scope inventory](../docs/research/2026-11-04-rewrite-progress-and-scope.md)
records the architectural decisions, partial ports, and work still needed before cutover.

| path | what | deploys to |
|---|---|---|
| `backend/` | zig appview: read-only API, ingester, projections | fly `plyr-api-zig-canary` (api.next.plyr.fm) via `deploy-next.yml` |
| `app/` | Expo / React Native client for iOS, Android, and web; writes go straight to the user's PDS | the web export deploys to Cloudflare Pages `plyr-fm-next` (next.plyr.fm) via `deploy-web-next.yml` |
| `services/audio/` | cloudflare worker + R2 audio mirror | `wrangler deploy` |
| `services/jams/` | room reducer and cross-PDS protocol probe; current room client lives in `app/` | no separate room-server deployment |

planned:

- `sdk/`: in-repo SDK for the new API (replaces the separate plyr-python-client repo), generated from the same contract the backend serves.
- `mcp/`: MCP server built on the SDK.

rules while next and legacy coexist:

- next owns its Fly app, Neon branch, R2 bucket and Pages project. Its runtime
  does not read or write Python's production tables, and its deploys do not
  promote the production app. Current auth discovery, legacy embed resolution
  and Radio still read production services; the inventory tracks those dependencies.
- the data is shared: next reads and writes the real `fm.plyr.*` records on
  users' PDSes. Public catalog writes show up in the existing app and must keep
  the published lexicon shapes and preserve fields Next doesn't know.
- a lexicon change lands in both apps together (lexicons/, the python backend,
  and next). gated uploads stay off on the real namespace until next's space
  shape converges with prod's `fm.plyr.privateMedia`.
- rolling back a next deploy doesn't undo records it wrote; they're the user's.
