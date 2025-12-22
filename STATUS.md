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

### December 2025

#### rate limit moderation endpoint (PR #629, Dec 21)

**incident response**: detected suspicious activity - 72 requests in 17 seconds from a single IP targeting `/moderation/sensitive-images`. investigation via Logfire showed:
- single IP generating all traffic with no User-Agent header
- requests spaced ~230ms apart (too consistent for human browsing)
- no corresponding user activity (page loads, audio streams)

**fix**: added `10/minute` rate limit to the endpoint using existing slowapi infrastructure. verified rate limiting works correctly post-deployment.

---

#### end-of-year sprint (Dec 20-31)

**focus**: two foundational systems need solid experimental implementations by 2026.

**track 1: moderation architecture overhaul**
- consolidate sensitive images into moderation service
- add event-sourced audit trail
- implement configurable rules (replace hard-coded thresholds)
- informed by [Roost Osprey](https://github.com/roostorg/osprey) patterns and [Bluesky Ozone](https://github.com/bluesky-social/ozone) workflows

**track 2: atprotofans paywall integration**
- phase 1: read-only supporter validation (show badges)
- phase 2: platform registration (artists create support tiers)
- phase 3: content gating (track-level access control)

**research docs**:
- [moderation architecture overhaul](docs/research/2025-12-20-moderation-architecture-overhaul.md)
- [atprotofans paywall integration](docs/research/2025-12-20-atprotofans-paywall-integration.md)

**tracking**: issue #625

---

#### beartype + moderation cleanup (PRs #617-619, Dec 19)

**runtime type checking** (PR #619):
- enabled beartype runtime type validation across the backend
- catches type errors at runtime instead of silently passing bad data
- test infrastructure improvements: session-scoped TestClient fixture (5x faster tests)
- disabled automatic perpetual task scheduling in tests

**moderation cleanup** (PRs #617-618):
- consolidated moderation code, addressing issues #541-543
- `sync_copyright_resolutions` now runs automatically via docket Perpetual task
- removed `init_db()` from lifespan (handled by alembic migrations)

---

#### UX polish (PRs #604-607, #613, #615, Dec 16-18)

**login improvements** (PRs #604, #613):
- login page now uses "internet handle" terminology for clarity
- input normalization: strips `@` and `at://` prefixes automatically

**artist page fixes** (PR #615):
- track pagination on artist pages now works correctly
- fixed mobile album card overflow

**mobile + metadata** (PRs #605-607):
- Open Graph tags added to tag detail pages for link previews
- mobile modals now use full screen positioning
- fixed `/tag/` routes in hasPageMetadata check

**misc** (PRs #598-601):
- upload button added to desktop header nav
- background settings UX improvements
- switched support link to atprotofans
- AudD costs now derived from track duration for accurate billing

---

#### offline mode foundation (PRs #610-611, Dec 17)

**experimental offline playback**:
- new storage layer using Cache API for audio bytes + IndexedDB for metadata
- `GET /audio/{file_id}/url` backend endpoint returns direct R2 URLs for client-side caching
- "auto-download liked" toggle in experimental settings section
- when enabled, bulk-downloads all liked tracks and auto-downloads future likes
- Player checks for cached audio before streaming from R2
- works offline once tracks are downloaded

**robustness improvements**:
- IndexedDB connections properly closed after each operation
- concurrent downloads deduplicated via in-flight promise tracking
- stale metadata cleanup when cache entries are missing

---

#### visual customization (PRs #595-596, Dec 16)

**custom backgrounds** (PR #595):
- users can set a custom background image URL in settings with optional tiling
- new "playing artwork as background" toggle - uses current track's artwork as blurred page background
- glass effect styling for track items (translucent backgrounds, subtle shadows)
- new `ui_settings` JSONB column in preferences for extensible UI settings

**bug fix** (PR #596):
- removed 3D wheel scroll effect that was blocking like/share button clicks
- root cause: `translateZ` transforms created z-index stacking that intercepted pointer events

---

#### performance & UX polish (PRs #586-593, Dec 14-15)

**performance improvements** (PRs #590-591):
- removed moderation service call from `/tracks/` listing endpoint
- removed copyright check from tag listing endpoint
- faster page loads for track feeds

**moderation agent** (PRs #586, #588):
- added moderation agent script with audit trail support
- improved moderation prompt and UI layout

**bug fixes** (PRs #589, #592, #593):
- fixed liked state display on playlist detail page
- preserved album track order during ATProto sync
- made header sticky on scroll for better mobile navigation

**iOS Safari fixes** (PRs #573-576):
- fixed AddToMenu visibility issue on iOS Safari
- menu now correctly opens upward when near viewport bottom

---

#### mobile UI polish & background task expansion (PRs #558-572, Dec 10-12)

**background task expansion** (PRs #558, #561):
- moved like/unlike and comment PDS writes to docket background tasks
- API responses now immediate; PDS sync happens asynchronously
- added targeted album list sync background task for ATProto record updates

**performance caching** (PR #566):
- added Redis cache for copyright label lookups (5-minute TTL)
- fixed 2-3s latency spikes on `/tracks/` endpoint
- batch operations via `mget`/pipeline for efficiency

**mobile UX improvements** (PRs #569, #572):
- mobile action menus now open from top with all actions visible
- UI polish for album and artist pages on small screens

**misc** (PRs #559, #562, #563, #570):
- reduced docket Redis polling from 250ms to 5s (lower resource usage)
- added atprotofans support link mode for ko-fi integration
- added alpha badge to header branding
- fixed web manifest ID for PWA stability

---

#### confidential OAuth client (PRs #578, #580-582, Dec 12-13)

**confidential client support** (PR #578):
- implemented ATProto OAuth confidential client using `private_key_jwt` authentication
- when `OAUTH_JWK` is configured, plyr.fm authenticates with a cryptographic key
- confidential clients earn 180-day refresh tokens (vs 2-week for public clients)
- added `/.well-known/jwks.json` endpoint for public key discovery
- updated `/oauth-client-metadata.json` with confidential client fields

**bug fixes** (PRs #580-582):
- fixed client assertion JWT to use Authorization Server's issuer as `aud` claim (not token endpoint URL)
- fixed JWKS endpoint to preserve `kid` field from original JWK
- fixed `OAuthClient` to pass `client_secret_kid` for JWT header

**atproto fork updates** (zzstoatzz/atproto#6, #7):
- added `issuer` parameter to `_make_token_request()` for correct `aud` claim
- added `client_secret_kid` parameter to include `kid` in client assertion JWT header

**outcome**: users now get 180-day refresh tokens, and "remember this account" on the PDS authorization page works (auto-approves subsequent logins). see #583 for future work on account switching via OAuth `prompt` parameter.

---

#### pagination & album management (PRs #550-554, Dec 9-10)

**tracks list pagination** (PR #554):
- cursor-based pagination on `/tracks/` endpoint (default 50 per page)
- infinite scroll on homepage using native IntersectionObserver
- zero new dependencies - uses browser APIs only
- pagination state persisted to localStorage for fast subsequent loads

**album management improvements** (PRs #550-552, #557):
- album delete and track reorder fixes
- album page edit mode matching playlist UX (inline title editing, cover upload)
- optimistic UI updates for album title changes (instant feedback)
- ATProto record sync when album title changes (updates all track records + list record)
- fixed album slug sync on rename (prevented duplicate albums when adding tracks)

**playlist show on profile** (PR #553):
- restored "show on profile" toggle that was lost during inline editing refactor
- users can now control whether playlists appear on their public profile

---

#### public cost dashboard (PRs #548-549, Dec 9)

- `/costs` page showing live platform infrastructure costs
- daily export to R2 via GitHub Action, proxied through `/stats/costs` endpoint
- dedicated `plyr-stats` R2 bucket with public access (shared across environments)
- includes fly.io, neon, cloudflare, and audd API costs
- ko-fi integration for community support

#### docket background tasks & concurrent exports (PRs #534-546, Dec 9)

**docket integration** (PRs #534, #536, #539):
- migrated background tasks from inline asyncio to docket (Redis-backed task queue)
- copyright scanning, media export, ATProto sync, and teal scrobbling now run via docket
- graceful fallback to asyncio for local development without Redis
- parallel test execution with xdist template databases (#540)

**concurrent export downloads** (PR #545):
- exports now download tracks in parallel (up to 4 concurrent) instead of sequentially
- significantly faster for users with many tracks or large files
- zip creation remains sequential (zipfile constraint)

**ATProto refactor** (PR #534):
- reorganized ATProto record code into `_internal/atproto/records/` by lexicon namespace
- extracted `client.py` for low-level PDS operations
- cleaner separation between plyr.fm and teal.fm lexicons

**documentation & observability**:
- AudD API cost tracking dashboard (#546)
- promoted runbooks from sandbox to `docs/runbooks/`
- updated CLAUDE.md files across the codebase

---

#### artist support links & inline playlist editing (PRs #520-532, Dec 8)

**artist support link** (PR #532):
- artists can set a support URL (Ko-fi, Patreon, etc.) in their portal profile
- support link displays as a button on artist profile pages next to the share button
- URLs validated to require https:// prefix

**inline playlist editing** (PR #531):
- edit playlist name and description directly on playlist detail page
- click-to-upload cover art replacement without modal
- cleaner UX - no more edit modal popup

**platform stats enhancements** (PRs #522, #528):
- total duration displayed in platform stats (e.g., "42h 15m of music")
- duration shown per artist in analytics section
- combined stats and search into single centered container for cleaner layout

**navigation & data loading fixes** (PR #527):
- fixed stale data when navigating between detail pages of the same type
- e.g., clicking from one artist to another now properly reloads data

**copyright moderation improvements** (PR #480):
- enhanced moderation workflow for copyright claims
- improved labeler integration

**status maintenance workflow** (PR #529):
- automated status maintenance using claude-code-action
- reviews merged PRs and updates STATUS.md narratively

---

#### playlist fast-follow fixes (PRs #507-519, Dec 7-8)

**public playlist viewing** (PR #519):
- playlists now publicly viewable without authentication
- ATProto records are public by design - auth was unnecessary for read access
- shared playlist URLs no longer redirect unauthenticated users to homepage

**inline playlist creation** (PR #510):
- clicking "create new playlist" from AddToMenu previously navigated to `/library?create=playlist`
- this caused SvelteKit to reinitialize the layout, destroying the audio element and stopping playback
- fix: added inline create form that creates playlist and adds track in one action without navigation

**UI polish** (PRs #507-509, #515):
- include `image_url` in playlist SSR data for og:image link previews
- invalidate layout data after token exchange - fixes stale auth state after login
- fixed stopPropagation blocking "create new playlist" link clicks
- detail page button layouts: all buttons visible on mobile, centered AddToMenu on track detail
- AddToMenu smart positioning: menu opens upward when near viewport bottom

**documentation** (PR #514):
- added lexicons overview documentation at `docs/lexicons/overview.md`
- covers `fm.plyr.track`, `fm.plyr.like`, `fm.plyr.comment`, `fm.plyr.list`, `fm.plyr.actor.profile`

---

#### playlists, ATProto sync, and library hub (PR #499, Dec 6-7)

**playlists** (full CRUD):
- create, rename, delete playlists with cover art upload
- add/remove/reorder tracks with drag-and-drop
- playlist detail page with edit modal
- "add to playlist" menu on tracks with inline create
- playlist sharing with OpenGraph link previews

**ATProto integration**:
- `fm.plyr.list` lexicon for syncing playlists/albums to user PDSes
- `fm.plyr.actor.profile` lexicon for artist profiles
- automatic sync of albums, liked tracks, profile on login

**library hub** (`/library`):
- unified page with tabs: liked, playlists, albums
- nav changed from "liked" → "library"

**related**: scope upgrade OAuth flow (PR #503), settings consolidation (PR #496)

---

#### sensitive image moderation (PRs #471-488, Dec 5-6)

- `sensitive_images` table flags problematic images
- `show_sensitive_artwork` user preference
- flagged images blurred everywhere: track lists, player, artist pages, search, embeds
- Media Session API respects sensitive preference
- SSR-safe filtering for og:image link previews

---

#### teal.fm scrobbling (PR #467, Dec 4)

- native scrobbling to user's PDS using teal's ATProto lexicons
- scrobble at 30% or 30 seconds (same threshold as play counts)
- toggle in settings, link to pdsls.dev to view records

---

### Earlier December / November 2025

See `.status_history/2025-12.md` and `.status_history/2025-11.md` for detailed history including:
- unified search with Cmd+K (PR #447)
- light/dark theme system (PR #441)
- tag filtering and bufo easter egg (PRs #431-438)
- developer tokens (PR #367)
- copyright moderation system (PRs #382-395)
- export & upload reliability (PRs #337-344)
- transcoder API deployment (PR #156)

## immediate priorities

### end-of-year sprint (Dec 20-31)

see [sprint tracking issue #625](https://github.com/zzstoatzz/plyr.fm/issues/625) for details.

| track | focus | status |
|-------|-------|--------|
| moderation | consolidate architecture, add rules engine | planning |
| atprotofans | supporter validation, content gating | planning |

### known issues
- playback auto-start on refresh (#225)
- iOS PWA audio may hang on first play after backgrounding

### backlog
- audio transcoding pipeline integration (#153) - transcoder service deployed, integration deferred
- share to bluesky (#334)
- lyrics and annotations (#373)

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

current monthly costs: ~$18/month (plyr.fm specific)

see live dashboard: [plyr.fm/costs](https://plyr.fm/costs)

- fly.io (plyr apps only): ~$12/month
  - relay-api (prod): $5.80
  - relay-api-staging: $5.60
  - plyr-moderation: $0.24
  - plyr-transcoder: $0.02
- neon postgres: $5/month
- cloudflare (R2 + pages + domain): ~$1.16/month
- audd audio fingerprinting: $0-10/month (6000 free/month)
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

this is a living document. last updated 2025-12-21.
