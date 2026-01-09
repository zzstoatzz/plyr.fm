# plyr.fm - status

## long-term vision

### the problem

today's music streaming is fundamentally broken:
- spotify and apple music trap your data in proprietary silos
- artists pay distribution fees and streaming cuts to multiple gatekeepers
- listeners can't own their music collections - they rent them
- switching platforms means losing everything: playlists, play history, social connections

### the atproto solution

plyr.fm is built on the AT Protocol (the protocol powering Bluesky) and enables:
- **portable identity**: your music collection, playlists, and listening history belong to you, stored in your personal data server (PDS)
- **decentralized distribution**: artists publish directly to the network without platform gatekeepers
- **interoperable data**: any client can read your music records - you're not locked into plyr.fm
- **authentic social**: artist profiles are real ATProto identities with verifiable handles (@artist.bsky.social)

### the dream state

plyr.fm should become:

1. **for artists**: the easiest way to publish music to the decentralized web
   - upload once, available everywhere in the ATProto network
   - direct connection to listeners without platform intermediaries
   - real ownership of audience relationships

2. **for listeners**: a streaming platform where you actually own your data
   - your collection lives in your PDS, playable by any ATProto music client
   - switch between plyr.fm and other clients freely - your data travels with you
   - share tracks as native ATProto posts to Bluesky

3. **for developers**: a reference implementation showing how to build on ATProto
   - open source end-to-end example of ATProto integration
   - demonstrates OAuth, record creation, federation patterns
   - proves decentralized music streaming is viable

---

**started**: October 28, 2025 (first commit: `454e9bc` - relay MVP with ATProto authentication)

---

## recent work

### January 2026

#### multi-account experience (PRs #707, #710, #712-714, Jan 3-5)

**why**: many users have multiple ATProto identities (personal, artist, label). forcing re-authentication to switch was friction that discouraged uploads from secondary accounts.

**users can now link multiple identities** to a single browser session:
- add additional accounts via "add account" in user menu (triggers OAuth with `prompt=login`)
- switch between linked accounts instantly without re-authenticating
- logout from individual accounts or all at once
- updated `/auth/me` returns `linked_accounts` array with avatars

**backend changes**:
- new `group_id` column on `user_sessions` links accounts together
- new `pending_add_accounts` table tracks in-progress OAuth flows
- new endpoints: `POST /auth/add-account/start`, `POST /auth/switch-account`, `POST /auth/logout-all`

**infrastructure fixes** (PRs #710, #712, #714):
these fixes came from reviewing [Bluesky's architecture deep dive](https://newsletter.pragmaticengineer.com/p/bluesky) which highlighted connection/resource management as scaling concerns. applied learnings to our own codebase:
- identified Neon serverless connection overhead (~77ms per connection) via Logfire
- cached `async_sessionmaker` per engine instead of recreating on every request (PR #712)
- changed `_refresh_locks` from unbounded dict to LRUCache (10k max, 1hr TTL) to prevent memory leak (PR #710)
- pass db session through auth helpers to reduce connections per request (PR #714)
- result: `/auth/switch-account` ~1100ms → ~800ms, `/auth/me` ~940ms → ~720ms

**frontend changes**:
- UserMenu (desktop): collapsible accounts submenu with linked accounts, add account, logout all
- ProfileMenu (mobile): dedicated accounts panel with avatars
- fixed `invalidateAll()` not refreshing client-side loaded data by using `window.location.reload()` (PR #713)

**docs**: [research/2026-01-03-multi-account-experience.md](docs/research/2026-01-03-multi-account-experience.md)

---

#### track edit UX improvements (PRs #741-742, Jan 9)

**why**: the portal track editing experience had several UX issues - users couldn't remove artwork (only replace), no preview when selecting new images, and buttons were poorly styled icon-only squares with overly aggressive hover effects.

**artwork management** (PR #742):
- add ability to **remove track artwork** via new `remove_image` form field on `PATCH /tracks/{id}`
- show **image preview** when selecting new artwork before saving
- hover overlay on current artwork with trash icon to remove
- "undo" option when artwork is marked for removal
- clear status labels: "current artwork", "new artwork selected", "artwork will be removed"

**button styling** (PR #742):
- replace icon-only squares with labeled pill buttons (`edit`, `delete`)
- subtle outlined save/cancel buttons in edit mode
- fix global button hover styles bleeding into all buttons (scoped to form submit only)

**shutdown fix** (PR #742):
- add 2s timeouts to docket worker and service shutdown
- prevents backend hanging on Ctrl+C or hot-reload during development

**beartype fix** (PR #741):
- `starlette.UploadFile` vs `fastapi.UploadFile` type mismatch was causing 500 errors on image upload
- fixed by importing UploadFile from starlette in metadata_service.py

---

#### auth stabilization (PRs #734-736, Jan 6-7)

**why**: multi-account support introduced edge cases where auth state could become inconsistent between frontend components, and sessions could outlive their refresh tokens.

**session expiry alignment** (PR #734):
- sessions now track refresh token lifetime and respect it during validation
- prevents sessions from appearing valid after their underlying OAuth grant expires
- dev token expiration handling aligned with same pattern

**queue auth boundary fix** (PR #735):
- queue component now uses shared layout auth state instead of localStorage session IDs
- fixes race condition where queue could attempt authenticated requests before layout resolved auth
- ensures remote queue snapshots don't inherit local update flags during hydration

**playlist cover upload fix** (PR #736):
- `R2Storage.save()` was rejecting `BytesIO` objects due to beartype's strict `BinaryIO` protocol checking
- changed type hint to `BinaryIO | BytesIO` to explicitly accept both
- found via Logfire: only 2 failures in production, both on Jan 3

---

#### timestamp deep links (PRs #739-740, Jan 8)

**timestamped comment sharing** (PR #739):
- timed comments now show share button on hover
- copies URL with `?t=` parameter (e.g., `plyr.fm/track/123?t=45`)
- visiting timestamped URL auto-seeks to that position on play

**autoplay error suppression** (PR #740):
- suppress browser autoplay errors when deep linking to timestamps
- browsers block autoplay without user interaction; now fails silently

---

#### artist bio links (PRs #700-701, Jan 2)

**links in artist bios now render as clickable** - supports full URLs and bare domains (e.g., "example.com"):
- regex extracts URLs from bio text
- bare domain/path URLs handled correctly
- links open in new tab

---

#### copyright moderation improvements (PRs #703-704, Jan 2-3)

**per legal advice**, redesigned copyright handling to reduce liability exposure:
- **disabled auto-labeling** (PR #703): labels are no longer automatically emitted when copyright matches are detected. the system now only flags and notifies, leaving takedown decisions to humans
- **raised threshold** (PR #703): copyright flag threshold increased from "any match" to configurable score (default 85%). controlled via `MODERATION_COPYRIGHT_SCORE_THRESHOLD` env var
- **DM notifications** (PR #704): when a track is flagged, both the artist and admin receive BlueSky DMs with details. includes structured error handling for when users have DMs disabled
- **observability** (PR #704): Logfire spans added to all notification paths (`send_dm`, `copyright_notification`) with error categorization (`dm_blocked`, `network`, `auth`, `unknown`)
- **notification tracking**: `notified_at` field added to `copyright_scans` table to track which flags have been communicated

**why this matters**: DMCA safe harbor requires taking action on notices, not proactively policing. auto-labeling was creating liability by making assertions about copyright status. human review is now required before any takedown action.

---

#### ATProto OAuth permission sets (PRs #697-698, Jan 1-2)

**permission sets enabled** - OAuth now uses `include:fm.plyr.authFullApp` instead of listing individual `repo:` scopes:
- users see clean "plyr.fm" permission title instead of raw collection names
- permission set lexicon published to `com.atproto.lexicon.schema` on plyr.fm authority repo
- DNS TXT records at `_lexicon.plyr.fm` and `_lexicon.stg.plyr.fm` link namespaces to authority DID
- fixed scope validation in atproto SDK fork to handle PDS permission expansion (`include:` → `repo?collection=`)

**why this matters**: permission sets are ATProto's mechanism for defining platform access tiers. enables future third-party integrations (mobile apps, read-only stats dashboards) to request semantic permission bundles instead of raw collection lists.

**docs**: [lexicons/overview.md](docs/lexicons/overview.md), [research/2026-01-01-atproto-oauth-permission-sets.md](docs/research/2026-01-01-atproto-oauth-permission-sets.md)

---

#### atprotofans supporters display (PRs #695-696, Jan 1)

**supporters now visible on artist pages** - artists using atprotofans can show their supporters:
- compact overlapping avatar circles (GitHub sponsors style) with "+N" overflow badge
- clicks link to supporter's plyr.fm artist page (keeps users in-app)
- `POST /artists/batch` endpoint enriches supporter DIDs with avatar_url from our Artist table
- frontend fetches from atprotofans, enriches via backend, renders with consistent avatar pattern

**route ordering fix** (PR #696): FastAPI was matching `/artists/batch` as `/{did}` with did="batch". moved POST route before the catchall GET route.

---

#### UI polish (PRs #692-694, Dec 31 - Jan 1)

- **feed/library toggle** (PR #692): consistent header layout with toggle between feed and library views
- **shuffle button moved** (PR #693): shuffle now in queue component instead of player controls
- **justfile consistency** (PR #694): standardized `just run` across frontend/backend modules

---

### December 2025

See `.status_history/2025-12.md` for detailed history including:
- header redesign and UI polish (PRs #691-693, Dec 31)
- automated image moderation with Claude vision (PRs #687-690, Dec 31)
- avatar sync on login (PR #685, Dec 31)
- top tracks homepage (PR #684, Dec 31)
- batch review system (PR #672, Dec 30)
- CSS design tokens (PRs #662-664, Dec 29-30)
- self-hosted redis migration (PRs #674-675, Dec 30)
- supporter-gated content (PR #637, Dec 22-23)
- supporter badges (PR #627, Dec 21-22)
- end-of-year sprint: moderation + atprotofans (PRs #617-629, Dec 19-21)
- offline mode foundation (PRs #610-611, Dec 17)
- UX polish and login improvements (PRs #604-615, Dec 16-18)
- visual customization with custom backgrounds (PRs #595-596, Dec 16)
- performance & moderation polish (PRs #586-593, Dec 14-15)
- mobile UI polish & background task expansion (PRs #558-572, Dec 10-12)
- confidential OAuth client for 180-day sessions (PRs #578-582, Dec 12-13)
- pagination & album management (PRs #550-554, Dec 9-10)
- public cost dashboard (PRs #548-549, Dec 9)
- docket background tasks & concurrent exports (PRs #534-546, Dec 9)
- artist support links & inline playlist editing (PRs #520-532, Dec 8)
- playlist fast-follow fixes (PRs #507-519, Dec 7-8)
- playlists, ATProto sync, and library hub (PR #499, Dec 6-7)
- sensitive image moderation (PRs #471-488, Dec 5-6)
- teal.fm scrobbling (PR #467, Dec 4)
- unified search with Cmd+K (PR #447, Dec 3)
- light/dark theme system (PR #441, Dec 2-3)
- tag filtering and bufo easter egg (PRs #431-438, Dec 2)

### November 2025

See `.status_history/2025-11.md` for detailed history including:
- developer tokens (PR #367)
- copyright moderation system (PRs #382-395)
- export & upload reliability (PRs #337-344)
- transcoder API deployment (PR #156)

## priorities

### current focus

stabilization and UX polish. track editing experience improved, shutdown reliability fixed.

**end-of-year sprint [#625](https://github.com/zzstoatzz/plyr.fm/issues/625) shipped:**
- moderation consolidation: sensitive images moved to moderation service (#644)
- moderation batch review UI with Claude vision integration (#672, #687-690)
- atprotofans: supporter badges (#627) and content gating (#637)

### known issues
- playback auto-start on refresh (#225)
- iOS PWA audio may hang on first play after backgrounding

### backlog
- audio transcoding pipeline integration (#153) - transcoder service deployed, integration deferred
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable rules engine for moderation
- time-release gating (#642)

## technical state

### architecture

**backend**
- language: Python 3.11+
- framework: FastAPI with uvicorn
- database: Neon PostgreSQL (serverless)
- storage: Cloudflare R2 (S3-compatible)
- background tasks: docket (Redis-backed)
- hosting: Fly.io (2x shared-cpu VMs)
- observability: Pydantic Logfire
- auth: ATProto OAuth 2.1

**frontend**
- framework: SvelteKit (v2.43.2)
- runtime: Bun
- hosting: Cloudflare Pages
- styling: vanilla CSS with lowercase aesthetic
- state management: Svelte 5 runes

**deployment**
- ci/cd: GitHub Actions
- backend: automatic on main branch merge (fly.io)
- frontend: automatic on every push to main (cloudflare pages)
- migrations: automated via fly.io release_command

**what's working**

**core functionality**
- ✅ ATProto OAuth 2.1 authentication
- ✅ multi-account support (link multiple ATProto identities)
- ✅ secure session management via HttpOnly cookies
- ✅ developer tokens with independent OAuth grants
- ✅ platform stats and Media Session API
- ✅ timed comments with clickable timestamps
- ✅ artist profiles synced with Bluesky
- ✅ track upload with streaming
- ✅ audio streaming via 307 redirects to R2 CDN
- ✅ play count tracking, likes, queue management
- ✅ unified search with Cmd/Ctrl+K
- ✅ teal.fm scrobbling
- ✅ copyright moderation with ATProto labeler
- ✅ docket background tasks (copyright scan, export, atproto sync, scrobble)
- ✅ media export with concurrent downloads
- ✅ supporter-gated content via atprotofans

**albums**
- ✅ album CRUD with cover art
- ✅ ATProto list records (auto-synced on login)

**playlists**
- ✅ full CRUD with drag-and-drop reordering
- ✅ ATProto list records (synced on create/modify)
- ✅ "add to playlist" menu, global search results

**deployment URLs**
- production frontend: https://plyr.fm
- production backend: https://api.plyr.fm
- staging: https://stg.plyr.fm / https://api-stg.plyr.fm

### technical decisions

**why Python/FastAPI instead of Rust?**
- rapid prototyping velocity during MVP phase
- trade-off: accepting higher latency for faster development

**why Cloudflare R2 instead of S3?**
- zero egress fees (critical for audio streaming)
- S3-compatible API, integrated CDN

**why async everywhere?**
- I/O-bound workload: most time spent waiting on network/disk
- PRs #149-151 eliminated all blocking operations

## cost structure

current monthly costs: ~$20/month (plyr.fm specific)

see live dashboard: [plyr.fm/costs](https://plyr.fm/costs)

- fly.io (backend + redis + moderation): ~$14/month
- neon postgres: $5/month
- cloudflare (R2 + pages + domain): ~$1/month
- audd audio fingerprinting: $5-10/month (usage-based)
- logfire: $0 (free tier)

## admin tooling

### content moderation
script: `scripts/delete_track.py`

usage:
```bash
uv run scripts/delete_track.py <track_id> --dry-run
uv run scripts/delete_track.py <track_id>
uv run scripts/delete_track.py --url https://plyr.fm/track/34
```

## for new contributors

### getting started
1. clone: `gh repo clone zzstoatzz/plyr.fm`
2. install dependencies: `uv sync && cd frontend && bun install`
3. run backend: `uv run uvicorn backend.main:app --reload`
4. run frontend: `cd frontend && bun run dev`
5. visit http://localhost:5173

### development workflow
1. create issue on github
2. create PR from feature branch
3. ensure pre-commit hooks pass
4. merge to main → deploys to staging
5. create github release → deploys to production

### key principles
- type hints everywhere
- lowercase aesthetic
- ATProto first
- async everywhere (no blocking I/O)
- mobile matters
- cost conscious

### project structure
```
plyr.fm/
├── backend/              # FastAPI app & Python tooling
│   ├── src/backend/      # application code
│   ├── tests/            # pytest suite
│   └── alembic/          # database migrations
├── frontend/             # SvelteKit app
│   ├── src/lib/          # components & state
│   └── src/routes/       # pages
├── moderation/           # Rust moderation service (ATProto labeler)
├── transcoder/           # Rust audio transcoding service
├── redis/                # self-hosted Redis config
├── docs/                 # documentation
└── justfile              # task runner
```

## documentation

- [docs/README.md](docs/README.md) - documentation index
- [runbooks](docs/runbooks/) - production incident procedures
- [background tasks](docs/backend/background-tasks.md) - docket task system
- [logfire querying](docs/tools/logfire.md) - observability queries
- [moderation & labeler](docs/moderation/atproto-labeler.md) - copyright, sensitive content
- [lexicons overview](docs/lexicons/overview.md) - ATProto record schemas

---

this is a living document. last updated 2026-01-09.
