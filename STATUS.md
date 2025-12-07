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

#### playlists, ATProto sync, and library hub (feat/playlists branch, PR #499, Dec 6-7)

**status**: feature-complete, ready for final review. ~8k lines changed.

**playlists** (full CRUD):
- `playlists` and `playlist_tracks` tables with Alembic migration
- `POST /lists/playlists` - create playlist
- `PUT /lists/playlists/{id}` - rename playlist
- `DELETE /lists/playlists/{id}` - delete playlist
- `POST /lists/playlists/{id}/tracks` - add track to playlist
- `DELETE /lists/playlists/{id}/tracks/{track_id}` - remove track
- `PUT /lists/playlists/{id}/tracks/reorder` - reorder tracks
- `POST /lists/playlists/{id}/cover` - upload cover art
- playlist detail page (`/playlist/[id]`) with edit modal, drag-and-drop reordering
- playlists in global search results
- "add to playlist" menu on tracks (filters out current playlist when on playlist page)
- "create new playlist" link in add-to menu → `/library?create=playlist`
- playlist sharing with OpenGraph link previews

**ATProto integration**:
- `fm.plyr.list` lexicon for syncing playlists and albums to user PDSes
- `fm.plyr.actor.profile` lexicon for syncing artist profiles
- automatic sync of albums, liked tracks, and profile on login (fire-and-forget)
- scope upgrade OAuth flow for teal.fm integration (#503)

**library hub** (`/library`):
- unified page with tabs: liked, playlists, albums
- create playlist modal (accessible via `/library?create=playlist` deep link)
- consistent card layouts across sections
- nav changed from "liked" → "library"

**user experience**:
- public liked pages for any user (`/liked/[handle]`)
- `show_liked_on_profile` preference
- portal album/playlist section visual consistency
- z-index fixes for dropdown menus

**design decisions**:
- lists are generic ordered collections of any ATProto records
- `listType` semantically categorizes (album, playlist, liked) but doesn't restrict content
- array order = display order, reorder via `putRecord`
- strongRef (uri + cid) for content-addressable item references
- "library" = umbrella term for personal collections

**file size audit** (candidates for future modularization):
- `portal/+page.svelte`: 2,436 lines (58% CSS)
- `playlist/[id]/+page.svelte`: 1,644 lines (48% CSS)
- `api/lists.py`: 855 lines
- CSS-heavy files could benefit from shared style extraction in future

**related issues**: #221, #146, #498

---

#### list reordering UI (feat/playlists branch, Dec 7)

**what's done**:
- `PUT /lists/liked/reorder` endpoint - reorder user's liked tracks list
- `PUT /lists/{rkey}/reorder` endpoint - reorder any list by ATProto rkey
- both endpoints take `items` array of strongRefs (uri + cid) in desired order
- liked tracks page (`/liked`) now has "reorder" button for authenticated users
- album page has "reorder" button for album owner (if album has ATProto list record)
- drag-and-drop reordering on desktop (HTML5 drag API)
- touch reordering on mobile (6-dot grip handle, same pattern as queue)
- visual feedback during drag: `.drag-over` and `.is-dragging` states
- saves order to ATProto via `putRecord` when user clicks "done"
- added `atproto_record_cid` to TrackResponse schema (needed for strongRefs)
- added `artist_did` and `list_uri` to AlbumMetadata response

**UX design**:
- button toggles between "reorder" and "done" states
- in edit mode, drag handles appear next to each track
- saving shows spinner, success/error toast on completion
- only owners can see/use reorder button (liked list = current user, album = artist)

---

#### scope upgrade OAuth flow (feat/scope-invalidation branch, Dec 7) - merged to feat/playlists

**problem**: when users enabled teal.fm scrobbling, the app showed a passive "please log out and back in" message because the session lacked the required OAuth scopes. this was confusing UX.

**solution**: immediate OAuth handshake when enabling features that require new scopes (same pattern as developer tokens).

**what's done**:
- `POST /auth/scope-upgrade/start` endpoint initiates OAuth with expanded scopes
- `pending_scope_upgrades` table tracks in-flight upgrades (10min TTL)
- callback replaces old session with new one, redirects to `/settings?scope_upgraded=true`
- frontend shows spinner during redirect, success toast on return
- fixed preferences bug where toggling settings reset theme to dark mode

**code quality**:
- eliminated bifurcated OAuth clients (`oauth_client` vs `oauth_client_with_teal`)
- replaced with `get_oauth_client(include_teal=False)` factory function
- at ~17 OAuth flows/day, instantiation cost is negligible
- explicit scope selection at call site instead of module-level state

**developer token UX**:
- full-page overlay when returning from OAuth after creating a developer token
- token displayed prominently with warning that it won't be shown again
- copy button with success feedback, link to python SDK docs
- prevents users from missing their token (was buried at bottom of page)

**test fixes**:
- fixed connection pool exhaustion in tests (was hitting Neon's connection limit)
- added `DATABASE_POOL_SIZE=2`, `DATABASE_MAX_OVERFLOW=0` to pytest env vars
- dispose cached engines after each test to prevent connection accumulation
- fixed mock function signatures for `refresh_session` tests

**tests**: 4 new tests for scope upgrade flow, all 281 tests passing

---

#### settings consolidation (PR #496, Dec 6)

**problem**: user preferences were scattered across multiple locations with confusing terminology:
- SensitiveImage tooltip said "enable in portal" but mobile menu said "profile"
- clicking gear icon (SettingsMenu) only showed appearance/playback, not all settings
- portal mixed content management with preferences

**solution**: clear separation between **settings** (preferences) and **portal** (content & data):

| page | purpose |
|------|---------|
| `/settings` | preferences: theme, accent color, auto-advance, sensitive artwork, timed comments, teal.fm, developer tokens |
| `/portal` | your content & data: profile, tracks, albums, export, delete account |

**changes**:
- created dedicated `/settings` route consolidating all user preferences
- slimmed portal to focus on content management
- added "all settings →" link to SettingsMenu and ProfileMenu
- renamed mobile menu "profile" → "portal" to match route
- moved delete account to portal's "your data" section (it's about data, not preferences)
- fixed `font-family: inherit` on all settings page buttons
- updated SensitiveImage tooltip: "enable in settings"

---

#### bufo easter egg improvements (PRs #491-492, Dec 6)

**what shipped**:
- configurable exclude/include patterns via env vars for bufo easter egg
- `BUFO_EXCLUDE_PATTERNS`: regex patterns to filter out (default: `^bigbufo_`)
- `BUFO_INCLUDE_PATTERNS`: allowlist that overrides exclude (default: `bigbufo_0_0`, `bigbufo_2_1`)
- cache key now includes patterns so config changes take effect immediately

**reusable type**:
- added `CommaSeparatedStringSet` type for parsing comma-delimited env vars into sets
- uses pydantic `BeforeValidator` with `Annotated` pattern (not class-coupled validators)
- handles: `VAR=a,b,c` → `{"a", "b", "c"}`

**context**: bigbufo tiles are 4x4 grid fragments that looked weird floating individually. now excluded by default, with two specific tiles allowed through.

**thread**: https://bsky.app/profile/zzstoatzzdevlog.bsky.social/post/3m7e3ndmgwl2m

---

#### mobile artwork upload fix (PR #489, Dec 6)

**problem**: artwork uploads from iOS Photos library silently failed - track uploaded successfully but without artwork.

**root cause**: iOS stores photos in HEIC format. when selected, iOS converts content to JPEG but often keeps the `.heic` filename. backend validated format using only filename extension → rejected as "unsupported format".

**fix**:
- backend now prefers MIME content_type over filename extension for format detection
- added `ImageFormat.from_content_type()` method
- frontend uses `accept="image/*"` for broader iOS compatibility

#### sensitive image moderation (PRs #471-488, Dec 5-6)

**what shipped**:
- `sensitive_images` table to flag problematic images by R2 `image_id` or external URL
- `show_sensitive_artwork` user preference (default: hidden, toggle in portal → "your data")
- flagged images blurred everywhere: track lists, player, artist pages, likers tooltip, search results, embeds
- Media Session API (CarPlay, lock screen, control center) respects sensitive preference
- SSR-safe filtering: link previews (og:image) exclude sensitive images on track, artist, and album pages
- likers tooltip UX: max-height with scroll, hover interaction fix, viewport-aware flip positioning
- likers tooltip z-index: elevates entire track-container when tooltip open (prevents sibling tracks bleeding through)

**how it works**:
- frontend fetches `/moderation/sensitive-images` and stores flagged IDs/URLs
- `SensitiveImage` component wraps images and checks against flagged list
- server-side check via `+layout.server.ts` for meta tag filtering
- users can opt-in to view sensitive artwork via portal toggle

**coverage** (PR #488):

| context | approach |
|---------|----------|
| DOM images needing blur | `SensitiveImage` component |
| small avatars in lists | `SensitiveImage` with `compact` prop |
| SSR meta tags (og:image) | `checkImageSensitive()` function |
| non-DOM APIs (media session) | direct `isSensitive()` + `showSensitiveArtwork` check |

**moderation workflow**:
- admin adds row to `sensitive_images` with `image_id` (R2) or `url` (external)
- images are blurred immediately for all users
- users who enable `show_sensitive_artwork` see unblurred images

---

#### teal.fm scrobbling integration (PR #467, Dec 4)

**what shipped**:
- native teal.fm scrobbling: when users enable the toggle, plays are recorded to their PDS using teal's ATProto lexicons
- scrobble triggers at 30% or 30 seconds (whichever comes first) - same threshold as play counts
- user preference stored in database, toggleable from portal → "your data"
- settings link to pdsls.dev so users can view their scrobble records

**lexicons used**:
- `fm.teal.alpha.feed.play` - individual play records (scrobbles)
- `fm.teal.alpha.actor.status` - now-playing status updates

**configuration** (all optional, sensible defaults):
- `TEAL_ENABLED` (default: `true`) - feature flag for entire integration
- `TEAL_PLAY_COLLECTION` (default: `fm.teal.alpha.feed.play`)
- `TEAL_STATUS_COLLECTION` (default: `fm.teal.alpha.actor.status`)

**code quality improvements** (same PR):
- added `settings.frontend.domain` computed property for environment-aware URLs
- extracted `get_session_id_from_request()` utility for bearer token parsing
- added field validator on `DeveloperTokenInfo.session_id` for auto-truncation
- applied walrus operators throughout auth and playback code
- fixed now-playing endpoint firing every 1 second (fingerprint update bug in scheduled reports)

**documentation**: `backend/src/backend/_internal/atproto/teal.py` contains inline docs on the scrobbling flow

---

#### unified search (PR #447, Dec 3)

**what shipped**:
- `Cmd+K` (mac) / `Ctrl+K` (windows/linux) opens search modal from anywhere
- fuzzy matching across tracks, artists, albums, and tags using PostgreSQL `pg_trgm`
- results grouped by type with relevance scores (0.0-1.0)
- keyboard navigation (arrow keys, enter, esc)
- artwork/avatars displayed with lazy loading and fallback icons
- glassmorphism modal styling with backdrop blur
- debounced input (150ms) with client-side validation

**database**:
- enabled `pg_trgm` extension for trigram-based similarity search
- GIN indexes on `tracks.title`, `artists.handle`, `artists.display_name`, `albums.title`, `tags.name`

**documentation**: `docs/frontend/search.md`, `docs/frontend/keyboard-shortcuts.md`

**follow-up polish** (PRs #449-463):
- mobile search icon in header (PRs #455-456)
- theme-aware modal styling with styled scrollbar (#450)
- ILIKE fallback for substring matches when trigram fails (#452)
- tag collapse with +N button (#453)
- input focus fix: removed `visibility: hidden` so focus works on open (#457, #463)
- album artwork fallback in player when track has no image (#458)
- rate limiting exemption for now-playing endpoints (#460)
- `--no-dev` flag for release command to prevent dev dep installation (#461)

---

#### light/dark theme and mobile UX overhaul (Dec 2-3)

**theme system** (PR #441):
- replaced hardcoded colors across 35 files with CSS custom properties
- semantic tokens: `--bg-primary`, `--text-secondary`, `--accent`, etc.
- theme switcher in settings: dark / light / system (follows OS preference)
- removed zen mode feature (superseded by proper theme support)

**mobile UX improvements** (PR #443):
- new `ProfileMenu` component — collapses profile, upload, settings, logout into touch-optimized menu (44px tap targets)
- dedicated `/upload` page — extracted from portal for cleaner mobile flow
- portal overhaul — tighter forms, track detail links under artwork, fixed icon alignment
- standardized section headers across home and liked tracks pages

**player scroll timing fix** (PR #445):
- reduced title scroll cycle from 10s → 8s, artist/album from 15s → 10s
- eliminated 1.5s invisible pause at end of scroll animation
- fixed duplicate upload toast (was firing twice on success)
- upload success toast now includes "view track" link

**CI optimization** (PR #444):
- pre-commit hooks now skip based on changed paths
- result: ~10s for most PRs instead of ~1m20s
- only installs tooling (uv, bun) needed for changed directories

---

#### tag filtering system and SDK tag support (Dec 2)

**tag filtering** (PRs #431-434):
- users can now hide tracks by tag via eye icon filter in discovery feed
- preferences centralized in root layout (fetched once, shared across app)
- `HiddenTagsFilter` component with expandable UI for managing hidden tags
- default hidden tags: `["ai"]` for new users
- tag detail pages at `/tag/[name]` with all tracks for that tag
- clickable tag badges on tracks navigate to tag pages

**navigation fix** (PR #435):
- fixed tag links interrupting audio playback
- root cause: `stopPropagation()` on links breaks SvelteKit's client-side router
- documented pattern in `docs/frontend/navigation.md` to prevent recurrence

**SDK tag support** (plyr-python-client v0.0.1-alpha.10):
- added `tags: set[str]` parameter to `upload()` in SDK
- added `-t/--tag` CLI option (can be used multiple times)
- updated MCP `upload_guide` prompt with tag examples
- status maintenance workflow now tags AI-generated podcasts with `ai` (#436)

**tags in detail pages** (PR #437):
- track detail endpoint (`/tracks/{id}`) now returns tags
- album detail endpoint (`/albums/{handle}/{slug}`) now returns tags for all tracks
- track detail page displays clickable tag badges

**bufo easter egg** (PR #438, improved in #491-492):
- tracks tagged with `bufo` trigger animated toad GIFs on the detail page
- uses track title as semantic search query against [find-bufo API](https://find-bufo.fly.dev/)
- toads are semantically matched to the song's vibe (e.g., "Happy Vibes" gets happy toads)
- results cached in localStorage (1 week TTL) to minimize API calls
- `TagEffects` wrapper component provides extensibility for future tag-based plugins
- respects `prefers-reduced-motion`; fails gracefully if API unavailable
- configurable exclude/include patterns via env vars (see Dec 6 entry above)

---

#### queue touch reordering and header stats fix (Dec 2)

**queue mobile UX** (PR #428):
- added 6-dot drag handle to queue items for touch-friendly reordering
- implemented touch event handlers for mobile drag-and-drop
- track follows finger during drag with smooth translateY transform
- drop target highlights while dragging over other tracks

**header stats positioning** (PR #426):
- fixed platform stats not adjusting when queue sidebar opens/closes
- added `--queue-width` CSS custom property updated dynamically
- stats now shift left with smooth transition when queue opens

---

#### connection pool resilience for Neon cold starts (Dec 2)

**incident**: ~5 minute API outage (01:55-02:00 UTC) - all requests returned 500 errors

**root cause**: Neon serverless cold start after 5 minutes of idle traffic
- queue listener heartbeat detected dead connection, began reconnection
- first 5 user requests each held a connection waiting for Neon to wake up (3-5 min each)
- with pool_size=5 and max_overflow=0, pool exhausted immediately
- all subsequent requests got `QueuePool limit of size 5 overflow 0 reached`

**fix**:
- increased `pool_size` from 5 → 10 (handle more concurrent cold start requests)
- increased `max_overflow` from 0 → 5 (allow burst to 15 connections)
- increased `connection_timeout` from 3s → 10s (wait for Neon wake-up)

**related**: this is a recurrence of the Nov 17 incident. that fix addressed the queue listener's asyncpg connection but not the SQLAlchemy pool connections.

---

#### now-playing API (PR #416, Dec 1)

**what shipped**:
- `GET /now-playing/{did}` and `GET /now-playing/by-handle/{handle}` endpoints
- returns track metadata, playback position, timestamp
- 204 when nothing playing, 200 with track data otherwise

**teal.fm integration**:
- native scrobbling shipped in PR #467 (Dec 4) - plyr.fm writes directly to user's PDS
- Piper integration (external polling) still open: https://github.com/teal-fm/piper/pull/27

---

#### admin UI improvements for moderation (PRs #408-414, Dec 1)

**what shipped**:
- dropdown menu for false positive reasons (fingerprint noise, original artist, fair use, other)
- artist/track links open in new tabs for verification
- AuDD score normalization (scores shown as 0-100 range)
- filter controls to show only high-confidence matches
- form submission fixes for htmx POST requests

---

#### ATProto labeler and copyright moderation (PRs #382-395, Nov 29-Dec 1)

**what shipped**:
- standalone labeler service integrated into moderation Rust service
- implements `com.atproto.label.queryLabels` and `subscribeLabels` XRPC endpoints
- k256 ECDSA signing for cryptographic label verification
- web interface at `/admin` for reviewing copyright flags
- htmx for server-rendered interactivity
- integrates with AuDD enterprise API for audio fingerprinting
- fire-and-forget background task on track upload
- review workflow with resolution tracking (violation, false_positive, original_artist)

**initial review results** (25 flagged tracks):
- 8 violations (actual copyright issues)
- 11 false positives (fingerprint noise)
- 6 original artists (people uploading their own distributed music)

**documentation**: see `docs/moderation/atproto-labeler.md`

---

#### developer tokens with independent OAuth grants (PR #367, Nov 28)

**what shipped**:
- each developer token gets its own OAuth authorization flow
- tokens have their own DPoP keypair, access/refresh tokens - completely separate from browser session
- cookie isolation: dev token exchange doesn't set browser cookie
- token management UI: portal → "your data" → "developer tokens"
- create with optional name and expiration (30/90/180/365 days or never)

**security properties**:
- tokens are full sessions with encrypted OAuth credentials (Fernet)
- each token refreshes independently
- revokable individually without affecting browser or other tokens

---

#### platform stats and media session integration (PRs #359-379, Nov 27-29)

**what shipped**:
- `GET /stats` returns total plays, tracks, and artists
- stats bar displays in homepage header (e.g., "1,691 plays • 55 tracks • 8 artists")
- Media Session API for CarPlay, lock screens, Bluetooth devices
- browser tab title shows "track - artist • plyr.fm" while playing
- timed comments with clickable timestamps
- constellation integration for network-wide like counts
- account deletion with explicit confirmation

---

#### export & upload reliability (PRs #337-344, Nov 24)

**what shipped**:
- database-backed jobs (moved tracking from in-memory to postgres)
- streaming exports (fixed OOM on large file exports)
- 90-minute WAV files now export successfully on 1GB VM
- upload progress bar fixes
- export filename now includes date

---

### October-November 2025

See `.status_history/2025-11.md` for detailed November development history including:
- async I/O performance fixes (PRs #149-151)
- transcoder API deployment (PR #156)
- upload streaming + progress UX (PR #182)
- liked tracks feature (PR #157)
- track detail pages (PR #164)
- mobile UI improvements (PRs #159-185)
- oEmbed endpoint for Leaflet.pub embeds (PRs #355-358)

## immediate priorities

### high priority features
1. **audio transcoding pipeline integration** (issue #153)
   - ✅ standalone transcoder service deployed at https://plyr-transcoder.fly.dev/
   - ⏳ next: integrate into plyr.fm upload pipeline
     - backend calls transcoder API for unsupported formats
     - queue-based job system for async processing
     - R2 integration (fetch original, store MP3)

### known issues
- playback auto-start on refresh (#225) - investigating localStorage/queue state persistence
- no ATProto records for albums yet (#221 - consciously deferred)
- no AIFF/AIF transcoding support (#153)
- iOS PWA audio may hang on first play after backgrounding - service worker caching interacts poorly with 307 redirects to R2 CDN. PR #466 added `NetworkOnly` for audio routes which should fix this, but iOS PWAs are slow to update service workers. workaround: delete home screen bookmark and re-add. may need further investigation if issue persists after SW propagates.

### new features
- issue #146: content-addressable storage (hash-based deduplication)
- issue #155: add track metadata (genres, tags, descriptions)
- issue #334: add 'share to bluesky' option for tracks
- issue #373: lyrics field and Genius-style annotations
- issue #393: moderation - represent confirmed takedown state in labeler

## technical state

### architecture

**backend**
- language: Python 3.11+
- framework: FastAPI with uvicorn
- database: Neon PostgreSQL (serverless)
- storage: Cloudflare R2 (S3-compatible)
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
- ✅ ATProto OAuth 2.1 authentication with encrypted state
- ✅ secure session management via HttpOnly cookies
- ✅ developer tokens with independent OAuth grants
- ✅ platform stats endpoint and homepage display
- ✅ Media Session API for CarPlay, lock screens, control center
- ✅ timed comments on tracks with clickable timestamps
- ✅ account deletion with explicit confirmation
- ✅ artist profiles synced with Bluesky
- ✅ track upload with streaming to prevent OOM
- ✅ track edit/deletion with cascade cleanup
- ✅ audio streaming via HTML5 player with 307 redirects to R2 CDN
- ✅ track metadata published as ATProto records
- ✅ play count tracking (30% or 30s threshold)
- ✅ like functionality with counts
- ✅ queue management (shuffle, auto-advance, reorder)
- ✅ mobile-optimized responsive UI
- ✅ cross-tab queue synchronization via BroadcastChannel
- ✅ share tracks via URL with Open Graph previews
- ✅ copyright moderation system with admin UI
- ✅ ATProto labeler for copyright violations
- ✅ unified search with Cmd/Ctrl+K (fuzzy matching via pg_trgm)
- ✅ teal.fm scrobbling (records plays to user's PDS)

**albums**
- ✅ album database schema with track relationships
- ✅ album browsing and detail pages
- ✅ album cover art upload and display
- ✅ server-side rendering for SEO
- ⏸ ATProto records for albums (deferred, see issue #221)

**deployment (fully automated)**
- **production**:
  - frontend: https://plyr.fm
  - backend: https://relay-api.fly.dev → https://api.plyr.fm
  - database: neon postgresql
  - storage: cloudflare R2 (audio-prod and images-prod buckets)

- **staging**:
  - backend: https://api-stg.plyr.fm
  - frontend: https://stg.plyr.fm
  - database: neon postgresql (relay-staging)
  - storage: cloudflare R2 (audio-stg bucket)

### technical decisions

**why Python/FastAPI instead of Rust?**
- rapid prototyping velocity during MVP phase
- rich ecosystem for web APIs
- excellent async support with asyncio
- trade-off: accepting higher latency for faster development

**why Cloudflare R2 instead of S3?**
- zero egress fees (critical for audio streaming)
- S3-compatible API (easy migration if needed)
- integrated CDN for fast delivery

**why forked atproto SDK?**
- upstream SDK lacked OAuth 2.1 support
- needed custom record management patterns
- maintains compatibility with ATProto spec

**why async everywhere?**
- event loop performance: single-threaded async handles high concurrency
- I/O-bound workload: most time spent waiting on network/disk
- PRs #149-151 eliminated all blocking operations

## cost structure

current monthly costs: ~$35-40/month

- fly.io backend (production): ~$5/month
- fly.io backend (staging): ~$5/month
- fly.io transcoder: ~$0-5/month (auto-scales to zero)
- neon postgres: $5/month
- audd audio fingerprinting: ~$10/month
- cloudflare pages: $0 (free tier)
- cloudflare R2: ~$0.16/month
- logfire: $0 (free tier)
- domain: $12/year (~$1/month)

## deployment URLs

- **production frontend**: https://plyr.fm
- **production backend**: https://api.plyr.fm
- **staging backend**: https://api-stg.plyr.fm
- **staging frontend**: https://stg.plyr.fm
- **repository**: https://github.com/zzstoatzz/plyr.fm (private)
- **monitoring**: https://logfire-us.pydantic.dev/zzstoatzz/relay
- **bluesky**: https://bsky.app/profile/plyr.fm

## admin tooling

### content moderation
script: `scripts/delete_track.py`
- requires `ADMIN_*` prefixed environment variables
- deletes audio file, cover image, database record
- notes ATProto records for manual cleanup

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
4. merge to main → deploys to staging automatically
5. verify on staging
6. create github release → deploys to production automatically

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
│   │   ├── api/          # public endpoints
│   │   ├── _internal/    # internal services
│   │   ├── models/       # database schemas
│   │   └── storage/      # storage adapters
│   ├── tests/            # pytest suite
│   └── alembic/          # database migrations
├── frontend/             # SvelteKit app
│   ├── src/lib/          # components & state
│   └── src/routes/       # pages
├── moderation/           # Rust moderation service (ATProto labeler)
│   ├── src/              # Axum handlers, AuDD client, label signing
│   └── static/           # admin UI (html/css/js)
├── transcoder/           # Rust audio transcoding service
├── docs/                 # documentation
└── justfile              # task runner
```

## documentation

- [deployment overview](docs/deployment/overview.md)
- [configuration guide](docs/configuration.md)
- [queue design](docs/queue-design.md)
- [logfire querying](docs/logfire-querying.md)
- [moderation & labeler](docs/moderation/atproto-labeler.md)
- [unified search](docs/frontend/search.md)
- [keyboard shortcuts](docs/frontend/keyboard-shortcuts.md)

---

this is a living document. last updated 2025-12-07.
