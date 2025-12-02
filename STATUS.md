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

## development timeline

### December 2025

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

**documentation**: updated `docs/backend/database/connection-pooling.md` with Neon serverless considerations and incident history.

---

#### now-playing API (PR #416, Dec 1)

**motivation**: expose what users are currently listening to via public API

**what shipped**:
- `GET /now-playing/{did}` and `GET /now-playing/by-handle/{handle}` endpoints
- returns track metadata, playback position, timestamp
- 204 when nothing playing, 200 with track data otherwise
- public endpoints (no auth required) - DIDs are already public identifiers

**speculative integration with teal.fm**:
- opened draft PR to Piper (teal.fm's scrobbling service): https://github.com/teal-fm/piper/pull/27
- adds plyr.fm as a source alongside Spotify and Last.fm
- tested end-to-end: plyr.fm → Piper → ATProto PDS (actor.status records)
- **status**: awaiting feedback from teal.fm team
- **alternative approach suggested**: teal.fm team suggested plyr.fm could write directly to `fm.teal.*` lexicons
  - concern: this couples plyr.fm to teal's internal schema - if they change lexicons, we'd need to fast-follow
  - Piper approach keeps cleaner boundaries: plyr.fm exposes API, Piper handles teal.fm integration
  - decision pending further discussion with teal.fm maintainers

---

#### admin UI improvements for moderation (PRs #408-414, Dec 1)

**motivation**: improve usability of copyright moderation admin UI based on real-world usage

**what shipped**:
- **reason selection for false positives** (PR #408):
  - dropdown menu when marking tracks as false positive
  - options: "fingerprint noise", "original artist", "fair use", "other"
  - stores reason in `review_notes` field
  - multi-step confirmation to prevent accidental clicks
- **UI polish** (PR #414):
  - artist/track links open in new tabs for easy verification
  - better visual hierarchy and spacing
  - improved button states and hover effects
- **AuDD score normalization** (PR #413):
  - AuDD enterprise returns scores as 0-100 range (not 0-1)
  - added score display to admin UI for transparency
  - filter controls to show only high-confidence matches
- **form submission fix** (PR #412):
  - switched from FormData to URLSearchParams
  - fixes htmx POST request encoding
  - ensures resolution actions work correctly

**impact**:
- faster moderation workflow (one-click access to verify tracks)
- better audit trail (reasons tracked for false positive resolutions)
- more transparent (shows match confidence scores)
- more reliable (form submission works consistently)

---

### November 2025

#### ATProto labeler and admin UI (PRs #385-395, Nov 29-Dec 1)

**motivation**: integrate with ATProto labeling protocol for proper copyright violation signaling, and improve admin tooling for reviewing flagged content.

**what shipped**:
- **ATProto labeler implementation** (PRs #385, #391):
  - standalone labeler service integrated into moderation Rust service
  - implements `com.atproto.label.queryLabels` and `subscribeLabels` XRPC endpoints
  - k256 ECDSA signing for cryptographic label verification
  - SQLite storage for labels with sequence numbers
  - labels emitted when copyright violations detected
  - negation labels for false positive resolution
- **admin UI** (PRs #390, #392, #395):
  - web interface at `/admin` for reviewing copyright flags
  - htmx for server-rendered interactivity (no inline JS bloat)
  - static files extracted to `moderation/static/` for proper syntax highlighting
  - plyr.fm design tokens for brand consistency
  - shows track title, artist handle, match scores, and potential matches
  - "mark false positive" button emits negation label
- **label context enrichment** (PR #392):
  - labels now include track_title, artist_handle, artist_did, highest_score, matches
  - backfill script (`scripts/backfill_label_context.py`) populated 25 existing flags
  - admin UI displays rich context instead of just ATProto URIs
- **copyright flag visibility** (PRs #387, #389):
  - artist portal shows copyright flag indicator on flagged tracks
  - tooltip shows primary match (artist - title) for quick context
- **documentation** (PR #386):
  - comprehensive docs at `docs/moderation/atproto-labeler.md`
  - covers architecture, label schema, XRPC protocol, signing keys

**admin UI architecture**:
- `moderation/static/admin.html` - page structure
- `moderation/static/admin.css` - plyr.fm design tokens
- `moderation/static/admin.js` - auth handling (~40 lines)
- htmx endpoints: `/admin/flags-html`, `/admin/resolve-htmx`
- server-rendered HTML partials for flag cards

---

#### copyright moderation system (PRs #382, #384, Nov 29-30)

**motivation**: detect potential copyright violations in uploaded tracks to avoid DMCA issues and protect the platform.

**what shipped**:
- **moderation service** (Rust/Axum on Fly.io):
  - standalone service at `plyr-moderation.fly.dev`
  - integrates with AuDD enterprise API for audio fingerprinting
  - scans audio URLs and returns matches with metadata (artist, title, album, ISRC, timecode)
  - auth via `X-Moderation-Key` header
- **backend integration** (PR #382):
  - `ModerationSettings` in config (service URL, auth token, timeout)
  - moderation client module (`backend/_internal/moderation.py`)
  - fire-and-forget background task on track upload
  - stores results in `copyright_scans` table
  - scan errors stored as "clear" so tracks aren't stuck unscanned
- **flagging fix** (PR #384):
  - AuDD enterprise API returns no confidence scores (all 0)
  - changed from score threshold to presence-based flagging: `is_flagged = !matches.is_empty()`
  - removed unused `score_threshold` config
- **backfill script** (`scripts/scan_tracks_copyright.py`):
  - scans existing tracks that haven't been checked
  - `--max-duration` flag to skip long DJ sets (estimated from file size)
  - `--dry-run` mode to preview what would be scanned
  - supports dev/staging/prod environments
- **review workflow**:
  - `copyright_scans` table has `resolution`, `reviewed_at`, `reviewed_by`, `review_notes` columns
  - resolution values: `violation`, `false_positive`, `original_artist`

**initial review results** (25 flagged tracks):
- 8 violations (actual copyright issues)
- 11 false positives (fingerprint noise)
- 6 original artists (people uploading their own distributed music)

---

#### developer tokens with independent OAuth grants (PR #367, Nov 28)

**motivation**: programmatic API access (scripts, CLIs, automation) needed tokens that survive browser logout and don't become stale when browser sessions refresh.

**what shipped**:
- **OAuth-based dev tokens**: each developer token gets its own OAuth authorization flow
  - user clicks "create token" → redirected to PDS for authorization → token created with independent credentials
  - tokens have their own DPoP keypair, access/refresh tokens - completely separate from browser session
- **cookie isolation**: dev token exchange doesn't set browser cookie
  - added `is_dev_token` flag to ExchangeToken model
  - /auth/exchange skips Set-Cookie for dev token flows
  - prevents logout from deleting dev tokens (critical bug fixed during implementation)
- **token management UI**: portal → "your data" → "developer tokens"
  - create with optional name and expiration (30/90/180/365 days or never)
  - list active tokens with creation/expiration dates
  - revoke individual tokens
- **API endpoints**:
  - `POST /auth/developer-token/start` - initiates OAuth flow, returns auth_url
  - `GET /auth/developer-tokens` - list user's tokens
  - `DELETE /auth/developer-tokens/{prefix}` - revoke by 8-char prefix

**security properties**:
- tokens are full sessions with encrypted OAuth credentials (Fernet)
- each token refreshes independently (no staleness from browser session refresh)
- revokable individually without affecting browser or other tokens
- explicit OAuth consent required at PDS for each token created

**documentation**: see `docs/authentication.md` "developer tokens" section

---

#### platform stats and media session integration (PRs #359-379, Nov 27-29)

**motivation**: show platform activity at a glance, improve playback experience across devices, and give users control over their data.

**what shipped**:
- **platform stats endpoint and UI** (PRs #376, #378, #379):
  - `GET /stats` returns total plays, tracks, and artists
  - stats bar displays in homepage header (e.g., "1,691 plays • 55 tracks • 8 artists")
  - skeleton loading animation while fetching
  - responsive layout: visible in header on wide screens, collapses to menu on narrow
  - end-of-list animation on homepage
- **Media Session API** (PR #371):
  - provides track metadata to CarPlay, lock screens, Bluetooth devices, macOS control center
  - artwork display with fallback to artist avatar
  - play/pause, prev/next, seek controls all work from system UI
  - position state syncs scrubbers on external interfaces
- **browser tab title** (PR #374):
  - shows "track - artist • plyr.fm" while playing
  - persists across page navigation
  - reverts to page title when playback stops
- **timed comments** (PR #359):
  - comments capture timestamp when added during playback
  - clickable timestamp buttons seek to that moment
  - compact scrollable comments section on track pages
- **constellation integration** (PR #360):
  - queries constellation.microcosm.blue backlink index
  - enables network-wide like counts (not just plyr.fm internal)
  - environment-aware namespace handling
- **account deletion** (PR #363):
  - explicit confirmation flow (type handle to confirm)
  - deletes all plyr.fm data (tracks, albums, likes, comments, preferences)
  - optional ATProto record cleanup with clear warnings about orphaned references

---

#### oEmbed endpoint for Leaflet.pub embeds (PRs #355-358, Nov 25)

**motivation**: plyr.fm tracks embedded in Leaflet.pub (via iframely) showed a black HTML5 audio box instead of our custom embed player.

**what shipped**:
- **oEmbed endpoint** (PR #355): `/oembed` returns proper embed HTML with iframe
  - follows oEmbed spec with `type: "rich"` and iframe in `html` field
  - discovery link in track page `<head>` for automatic detection
- **iframely domain registration**: registered plyr.fm on iframely.com (free tier)
  - this was the key fix - iframely now returns our embed iframe as `links.player[0]`

**debugging journey** (PRs #356-358):
- initially tried `og:video` meta tags to hint iframe embed - didn't work
- tried removing `og:audio` to force oEmbed fallback - resulted in no player link
- discovered iframely requires domain registration to trust oEmbed providers
- after registration, iframely correctly returns embed iframe URL

---

#### export & upload reliability (PRs #337-344, Nov 24)

**motivation**: exports were failing silently on large files (OOM), uploads showed incorrect progress, and SSE connections triggered false error toasts.

**what shipped**:
- **database-backed jobs** (PR #337): moved upload/export tracking from in-memory to postgres
  - jobs table persists state across server restarts
  - enables reliable progress tracking via SSE polling
- **streaming exports** (PR #343): fixed OOM on large file exports
  - previously loaded entire files into memory via `response["Body"].read()`
  - now streams to temp files, adds to zip from disk (constant memory)
  - 90-minute WAV files now export successfully on 1GB VM
- **progress tracking fix** (PR #340): upload progress was receiving bytes but treating as percentage
  - `UploadProgressTracker` now properly converts bytes to percentage
  - upload progress bar works correctly again
- **UX improvements** (PRs #338-339, #341-342, #344):
  - export filename now includes date (`plyr-tracks-2025-11-24.zip`)
  - toast notification on track deletion
  - fixed false "lost connection" error when SSE completes normally
  - progress now shows "downloading track X of Y" instead of confusing count

---

#### queue hydration + ATProto token hardening (Nov 12)

**why**: queue endpoints were occasionally taking 2s+ and restore operations could 401
when multiple requests refreshed an expired ATProto token simultaneously.

**what shipped**:
- added persistent `image_url` on `Track` rows so queue hydration no longer probes R2
  for every track. Queue payloads now pull art directly from Postgres, with a one-time
  fallback for legacy rows.
- updated `_internal/queue.py` to backfill any missing URLs once (with caching) instead
  of per-request GETs.
- introduced per-session locks in `_refresh_session_tokens` so only one coroutine hits
  `oauth_client.refresh_session` at a time; others reuse the refreshed tokens. This
  removes the race that caused the batch restore flow to intermittently 500/401.

**impact**: queue tail latency dropped back under 500 ms in staging tests, ATProto restore flows are now reliable under concurrent use, and Logfire no longer shows 500s from the PDS.

---

#### performance optimization session (Nov 12)

**issue: slow /tracks/liked endpoint**

**symptoms**:
- `/tracks/liked` taking 600-900ms consistently
- only ~25ms spent in database queries
- mysterious 575ms gap with no spans in Logfire traces

**root cause**:
- PR #184 added `image_url` column to tracks table to eliminate N+1 R2 API calls
- legacy tracks (15 tracks uploaded before PR) had `image_url = NULL`
- fallback code called `track.get_image_url()` which makes uninstrumented R2 `head_object` API calls
- 5 tracks × 120ms = ~600ms of uninstrumented latency

**solution**: created `scripts/backfill_image_urls.py` to populate missing `image_url` values

**results**:
- `/tracks/liked` now sub-200ms (down from 600-900ms)
- all endpoints now consistently sub-second response times

**database cleanup**:
- discovered `queue_state` had 265% bloat (53 dead rows, 20 live rows)
- ran `VACUUM (FULL, ANALYZE) queue_state` against production

---

#### track detail pages (PR #164, Nov 12)

- ✅ dedicated track detail pages with large cover art
- ✅ play button updates queue state correctly (#169)
- ✅ liked state loaded efficiently via server-side fetch
- ✅ mobile-optimized layouts with proper scrolling constraints
- ✅ origin validation for image URLs (#168)

---

#### liked tracks feature (PR #157, Nov 11)

- ✅ server-side persistent collections
- ✅ ATProto record publication for cross-platform visibility
- ✅ UI for adding/removing tracks from liked collection
- ✅ like counts displayed in track responses and analytics (#170)
- ✅ analytics cards now clickable links to track detail pages (#171)
- ✅ liked state shown on artist page tracks (#163)

**status**: COMPLETE (issue #144 closed)

---

#### upload streaming + progress UX (PR #182, Nov 11)

- Frontend switched from `fetch` to `XMLHttpRequest` so we can display upload progress
  toasts (critical for >50 MB mixes on mobile).
- Upload form now clears only after the request succeeds; failed attempts leave the
  form intact so users don't lose metadata.
- Backend writes uploads/images to temp files in 8 MB chunks before handing them to the
  storage layer, eliminating whole-file buffering and iOS crashes for hour-long mixes.
- Deployment verified locally and by rerunning the exact repro Stella hit (85 minute
  mix from mobile).

---

#### transcoder API deployment (PR #156, Nov 11)

**standalone Rust transcoding service** 🎉
- **deployed**: https://plyr-transcoder.fly.dev/
- **purpose**: convert AIFF/FLAC/etc. to MP3 for browser compatibility
- **technology**: Axum + ffmpeg + Docker
- **security**: `X-Transcoder-Key` header authentication (shared secret)
- **capacity**: handles 1GB uploads, tested with 85-minute AIFF files (~858MB → 195MB MP3 in 32 seconds)
- **architecture**:
  - 2 Fly machines for high availability
  - auto-stop/start for cost efficiency
  - stateless design (no R2 integration yet)
  - 320kbps MP3 output with proper ID3 tags
- **status**: deployed and tested, ready for integration into plyr.fm upload pipeline
- **next steps**: wire into backend with R2 integration and job queue (see issue #153)

---

#### AIFF/AIF browser compatibility fix (PR #152, Nov 11)

**format validation improvements**
- **problem discovered**: AIFF/AIF files only work in Safari, not Chrome/Firefox
  - browsers throw `MediaError code 4: MEDIA_ERR_SRC_NOT_SUPPORTED`
  - users could upload files but they wouldn't play in most browsers
- **immediate solution**: reject AIFF/AIF uploads at both backend and frontend
  - removed AIFF/AIF from AudioFormat enum
  - added format hints to upload UI: "supported: mp3, wav, m4a"
  - client-side validation with helpful error messages
- **long-term solution**: deployed standalone transcoder service (see above)
  - separate Rust/Axum service with ffmpeg
  - accepts all formats, converts to browser-compatible MP3
  - integration into upload pipeline pending (issue #153)

**observability improvements**:
- added logfire instrumentation to upload background tasks
- added logfire spans to R2 storage operations
- documented logfire querying patterns in `docs/logfire-querying.md`

---

#### async I/O performance fixes (PRs #149-151, Nov 10-11)

Eliminated event loop blocking across backend with three critical PRs:

1. **PR #149: async R2 reads** - converted R2 `head_object` operations from sync boto3 to async aioboto3
   - portal page load time: 2+ seconds → ~200ms
   - root cause: `track.image_url` was blocking on serial R2 HEAD requests

2. **PR #150: concurrent PDS resolution** - parallelized ATProto PDS URL lookups
   - homepage load time: 2-6 seconds → 200-400ms
   - root cause: serial `resolve_atproto_data()` calls (8 artists × 200-300ms each)
   - fix: `asyncio.gather()` for batch resolution, database caching for subsequent loads

3. **PR #151: async storage writes/deletes** - made save/delete operations non-blocking
   - R2: switched to `aioboto3` for uploads/deletes (async S3 operations)
   - filesystem: used `anyio.Path` and `anyio.open_file()` for chunked async I/O (64KB chunks)
   - impact: multi-MB uploads no longer monopolize worker thread, constant memory usage

---

#### mobile UI improvements (PRs #159-185, Nov 11-12)

- ✅ compact action menus and better navigation (#161)
- ✅ improved mobile responsiveness (#159)
- ✅ consistent button layouts across mobile/desktop (#176-181, #185)
- ✅ always show play count and like count on mobile (#177)
- ✅ login page UX improvements (#174-175)
- ✅ liked page UX improvements (#173)
- ✅ accent color for liked tracks (#160)

---

### October-November 2025 (early development)

#### cover art support (PRs #123-126, #132-139, early Nov)
- ✅ track cover image upload and storage (separate R2 bucket)
- ✅ image display on track pages and player
- ✅ Open Graph meta tags for track sharing
- ✅ mobile-optimized layouts with cover art
- ✅ sticky bottom player on mobile with cover

---

#### queue management improvements (PRs #110-113, #115, late Oct-early Nov)
- ✅ visual feedback on queue add/remove
- ✅ toast notifications for queue actions
- ✅ better error handling for queue operations
- ✅ improved shuffle and auto-advance UX

---

#### infrastructure and tooling (Oct-Nov)
- ✅ R2 bucket separation: audio-prod and images-prod (PR #124)
- ✅ admin script for content moderation (`scripts/delete_track.py`)
- ✅ bluesky attribution link in header
- ✅ changelog target added (#183)
- ✅ documentation updates (#158)
- ✅ track metadata edits now persist correctly (#162)

## immediate priorities

### high priority features
1. **audio transcoding pipeline integration** (issue #153)
   - ✅ standalone transcoder service deployed at https://plyr-transcoder.fly.dev/
   - ✅ Rust/Axum service with ffmpeg, tested with 85-minute files
   - ✅ secure auth via X-Transcoder-Key header
   - ⏳ next: integrate into plyr.fm upload pipeline
     - backend calls transcoder API for unsupported formats
     - queue-based job system for async processing
     - R2 integration (fetch original, store MP3)
     - maintain original file hash for deduplication
     - handle transcoding failures gracefully

### resolved bugs
1. ~~**upload reliability** (issue #147): upload returns 200 but file missing from R2, no error logged~~
   - **status**: FIXED (issue #147 closed)
   - improved error handling and retry logic in background upload task

2. **database connection pool SSL errors**: intermittent failures on first request
   - symptom: `/tracks/` returns 500 on first request, succeeds after
   - fix: set `pool_pre_ping=True`, adjust `pool_recycle` for Neon timeouts
   - documented in `docs/logfire-querying.md`

### performance optimizations
3. **persist concrete file extensions in database**: currently brute-force probing all supported formats on read
   - already know `Track.file_type` and image format during upload
   - eliminating repeated `exists()` checks reduces filesystem/R2 HEAD spam
   - improves audio streaming latency (`/audio/{file_id}` endpoint walks extensions sequentially)

4. **stream large uploads directly to storage**: current implementation reads entire file into memory before background task
   - multi-GB uploads risk OOM
   - stream from `UploadFile.file` → storage backend for constant memory usage

### new features
5. **content-addressable storage** (issue #146)
   - hash-based file storage for automatic deduplication
   - reduces storage costs when multiple artists upload same file
   - enables content verification

## open issues by timeline

### immediate
- issue #153: audio transcoding pipeline (ffmpeg worker for AIFF/FLAC→MP3)

### short-term
- issue #146: content-addressable storage (hash-based deduplication)
- issue #24: implement play count abuse prevention
- database connection pool tuning (SSL errors)
- file extension persistence in database

### medium-term
- issue #208: security - medium priority hardening tasks
- issue #207: security - add comprehensive input validation
- issue #46: consider removing init_db() from lifespan in favor of migration-only approach
- issue #56: design public developer API and versioning
  - **note**: SDK (`plyrfm`) and MCP server (`plyrfm-mcp`) now available at https://github.com/zzstoatzz/plyr-python-client
  - `plyrfm` on PyPI - Python SDK + CLI for plyr.fm API
  - `plyrfm-mcp` on PyPI - MCP server, hosted at https://plyrfm.fastmcp.app/mcp
  - issue still open for formal API versioning and public documentation
- issue #57: support multiple audio item types (voice memos/snippets)
- issue #122: fullscreen player for immersive playback
- issue #155: add track metadata (genres, tags, descriptions)
- issue #166: content moderation for user-uploaded images
- issue #167: DMCA safe harbor compliance
- issue #186: liquid glass effects as user-configurable setting
- issue #221: first-class albums (ATProto records)
- issue #334: add 'share to bluesky' option for tracks
- issue #373: lyrics field and Genius-style annotations
- issue #393: moderation - represent confirmed takedown state in labeler

### long-term
- migrate to plyr-owned lexicon (custom ATProto namespace with richer metadata)
- publish to multiple ATProto AppViews for cross-platform visibility
- explore ATProto-native notifications (replace Bluesky DM bot)
- realtime queue syncing across devices via SSE/WebSocket
- artist analytics dashboard improvements
- issue #44: modern music streaming feature parity

## technical state

### architecture

**backend**
- language: Python 3.11+
- framework: FastAPI with uvicorn
- database: Neon PostgreSQL (serverless, fully managed)
- storage: Cloudflare R2 (S3-compatible object storage)
- hosting: Fly.io (2x shared-cpu VMs, auto-scaling)
- observability: Pydantic Logfire (traces, metrics, logs)
- auth: ATProto OAuth 2.1 (forked SDK: github.com/zzstoatzz/atproto)

**frontend**
- framework: SvelteKit (latest v2.43.2)
- runtime: Bun (fast JS runtime)
- hosting: Cloudflare Pages (edge network)
- styling: vanilla CSS with lowercase aesthetic
- state management: Svelte 5 runes ($state, $derived, $effect)

**deployment**
- ci/cd: GitHub Actions
- backend: automatic on main branch merge (fly.io deploy)
- frontend: automatic on every push to main (cloudflare pages)
- migrations: automated via fly.io release_command
- environments: dev → staging → production (full separation)
- versioning: nebula timestamp format (YYYY.MMDD.HHMMSS)

**key dependencies**
- atproto: forked SDK for OAuth and record management
- sqlalchemy: async ORM for postgres
- alembic: database migrations
- boto3/aioboto3: R2 storage client
- logfire: observability (FastAPI + SQLAlchemy instrumentation)
- httpx: async HTTP client

**what's working**

**core functionality**
- ✅ ATProto OAuth 2.1 authentication with encrypted state
- ✅ secure session management via HttpOnly cookies (XSS protection)
- ✅ developer tokens with independent OAuth grants (programmatic API access)
- ✅ platform stats endpoint and homepage display (plays, tracks, artists)
- ✅ Media Session API for CarPlay, lock screens, control center
- ✅ timed comments on tracks with clickable timestamps
- ✅ account deletion with explicit confirmation
- ✅ artist profiles synced with Bluesky (avatar, display name, handle)
- ✅ track upload with streaming to prevent OOM
- ✅ track edit (title, artist, album, features metadata)
- ✅ track deletion with cascade cleanup
- ✅ audio streaming via HTML5 player with 307 redirects to R2 CDN
- ✅ track metadata published as ATProto records (fm.plyr.track namespace)
- ✅ play count tracking with threshold (30% or 30s, whichever comes first)
- ✅ like functionality with counts
- ✅ artist analytics dashboard
- ✅ queue management (shuffle, auto-advance, reorder)
- ✅ mobile-optimized responsive UI
- ✅ cross-tab queue synchronization via BroadcastChannel
- ✅ share tracks via URL with Open Graph previews (including cover art)
- ✅ image URL caching in database (eliminates N+1 R2 calls)
- ✅ format validation (rejects AIFF/AIF, accepts MP3/WAV/M4A with helpful error messages)
- ✅ standalone audio transcoding service deployed and verified (see issue #153)
- ✅ Bluesky embed player UI changes implemented (pending upstream social-app PR)
- ✅ admin content moderation script for removing inappropriate uploads
- ✅ copyright moderation system (AuDD fingerprinting, review workflow, violation tracking)
- ✅ ATProto labeler for copyright violations (queryLabels, subscribeLabels XRPC endpoints)
- ✅ admin UI for reviewing flagged tracks with htmx (plyr-moderation.fly.dev/admin)

**albums**
- ✅ album database schema with track relationships
- ✅ album browsing pages (`/u/{handle}` shows discography)
- ✅ album detail pages (`/u/{handle}/album/{slug}`) with full track lists
- ✅ album cover art upload and display
- ✅ server-side rendering for SEO
- ✅ rich Open Graph metadata for link previews (music.album type)
- ✅ long album title handling (100-char slugs, CSS truncation)
- ⏸ ATProto records for albums (deferred, see issue #221)

**frontend architecture**
- ✅ server-side data loading (`+page.server.ts`) for artist and album pages
- ✅ client-side data loading (`+page.ts`) for auth-dependent pages
- ✅ centralized auth manager (`lib/auth.svelte.ts`)
- ✅ layout-level auth state (`+layout.ts`) shared across all pages
- ✅ eliminated "flash of loading" via proper load functions
- ✅ consistent auth patterns (no scattered localStorage calls)

**deployment (fully automated)**
- **production**:
  - frontend: https://plyr.fm (cloudflare pages)
  - backend: https://relay-api.fly.dev (fly.io: 2 machines, 1GB RAM, 1 shared CPU, min 1 running)
  - database: neon postgresql
  - storage: cloudflare R2 (audio-prod and images-prod buckets)
  - deploy: github release → automatic

- **staging**:
  - backend: https://api-stg.plyr.fm (fly.io: relay-api-staging)
  - frontend: https://stg.plyr.fm (cloudflare pages: plyr-fm-stg)
  - database: neon postgresql (relay-staging)
  - storage: cloudflare R2 (audio-stg bucket)
  - deploy: push to main → automatic

- **development**:
  - backend: localhost:8000
  - frontend: localhost:5173
  - database: neon postgresql (relay-dev)
  - storage: cloudflare R2 (audio-dev and images-dev buckets)

- **developer tooling**:
  - `just serve` - run backend locally
  - `just dev` - run frontend locally
  - `just test` - run test suite
  - `just release` - create production release (backend + frontend)
  - `just release-frontend-only` - deploy only frontend changes (added Nov 13)

### what's in progress

**immediate work**
- investigating playback auto-start behavior (#225)
  - page refresh sometimes starts playing immediately
  - may be related to queue state restoration or localStorage caching
  - `autoplay_next` preference not being respected in all cases
- liquid glass effects as user-configurable setting (#186)

**active research**
- transcoding pipeline architecture (see sandbox/transcoding-pipeline-plan.md)
- content moderation systems (#166, #167, #393 - takedown state representation)
- PWA capabilities and offline support (#165)

### known issues

**player behavior**
- playback auto-start on refresh (#225)
  - sometimes plays immediately after page load
  - investigating localStorage/queue state persistence
  - may not respect `autoplay_next` preference in all scenarios

**missing features**
- no ATProto records for albums yet (#221 - consciously deferred)
- no track genres/tags/descriptions yet (#155)
- no AIFF/AIF transcoding support (#153)
- no PWA installation prompts (#165)
- no fullscreen player view (#122)

**technical debt**
- multi-tab playback synchronization could be more robust
- queue state conflicts can occur with rapid operations

### technical decisions

**why Python/FastAPI instead of Rust?**
- rapid prototyping velocity during MVP phase
- rich ecosystem for web APIs (fastapi, sqlalchemy, pydantic)
- excellent async support with asyncio
- lower barrier to contribution
- trade-off: accepting higher latency for faster development
- future: can migrate hot paths to Rust if needed (transcoding service already planned)

**why Fly.io instead of AWS/GCP?**
- simple deployment model (dockerfile → production)
- automatic SSL/TLS certificates
- built-in global load balancing
- reasonable pricing for MVP ($5/month)
- easy migration path to larger providers later
- trade-off: vendor-specific features, less control

**why Cloudflare R2 instead of S3?**
- zero egress fees (critical for audio streaming)
- S3-compatible API (easy migration if needed)
- integrated CDN for fast delivery
- significantly cheaper than S3 for bandwidth-heavy workloads

**why forked atproto SDK?**
- upstream SDK lacked OAuth 2.1 support
- needed custom record management patterns
- maintains compatibility with ATProto spec
- contributes improvements back when possible

**why SvelteKit instead of React/Next.js?**
- Svelte 5 runes provide excellent reactivity model
- smaller bundle sizes (critical for mobile)
- less boilerplate than React
- SSR + static generation flexibility
- modern DX with TypeScript

**why Neon instead of self-hosted Postgres?**
- serverless autoscaling (no capacity planning)
- branch-per-PR workflow (preview databases)
- automatic backups and point-in-time recovery
- generous free tier for MVP
- trade-off: higher latency than co-located DB, but acceptable

**why reject AIFF instead of transcoding immediately?**
- MVP speed: transcoding requires queue infrastructure, ffmpeg setup, error handling
- user communication: better to be upfront about limitations than silent failures
- resource management: transcoding is CPU-intensive, needs proper worker architecture
- future flexibility: can add transcoding as optional feature (high-quality uploads → MP3 delivery)
- trade-off: some users can't upload AIFF now, but those who can upload MP3 have working experience

**why async everywhere?**
- event loop performance: single-threaded async handles high concurrency
- I/O-bound workload: most time spent waiting on network/disk
- recent work (PRs #149-151) eliminated all blocking operations
- alternative: thread pools for blocking I/O, but increases complexity
- trade-off: debugging async code harder than sync, but worth throughput gains

**why anyio.Path over thread pools?**
- true async I/O: `anyio` uses OS-level async file operations where available
- constant memory: chunked reads/writes (64KB) prevent OOM on large files
- thread pools: would work but less efficient, more context switching
- trade-off: anyio API slightly different from stdlib `pathlib`, but cleaner async semantics

## cost structure

current monthly costs: ~$5-6

- cloudflare pages: $0 (free tier)
- cloudflare R2: ~$0.16 (storage + operations, no egress fees)
- fly.io production: $5.00 (2x shared-cpu-1x VMs with auto-stop)
- fly.io staging: $0 (auto-stop, only runs during testing)
- neon: $0 (free tier, 0.5 CPU, 512MB RAM, 3GB storage)
- logfire: $0 (free tier)
- domain: $12/year (~$1/month)

## deployment URLs

- **production frontend**: https://plyr.fm
- **production backend**: https://relay-api.fly.dev (redirects to https://api.plyr.fm)
- **staging backend**: https://api-stg.plyr.fm
- **staging frontend**: https://stg.plyr.fm
- **repository**: https://github.com/zzstoatzz/plyr.fm (private)
- **monitoring**: https://logfire-us.pydantic.dev/zzstoatzz/relay
- **bluesky**: https://bsky.app/profile/plyr.fm
- **latest release**: 2025.1129.214811

## health indicators

**production status**: ✅ healthy
- uptime: consistently available
- response times: <500ms p95 for API endpoints
- error rate: <1% (mostly invalid OAuth states)
- storage: ~12 tracks uploaded, functioning correctly

**key metrics**
- total tracks: ~12
- total artists: ~3
- play counts: tracked per-track
- storage used: <1GB R2
- database size: <10MB postgres

## next session prep

**context for new agent:**
1.  Fixed R2 image upload path mismatch, ensuring images save with the correct prefix.
2.  Implemented UI changes for the embed player: removed the Queue button and matched fonts to the main app.
3.  Opened a draft PR to the upstream social-app repository for native Plyr.fm embed support.
4.  Updated issue #153 (transcoding pipeline) with a clear roadmap for integration into the backend.
5.  Developed a local verification script for the transcoder service for faster local iteration.

**useful commands:**
- `just backend run` - run backend locally
- `just frontend dev` - run frontend locally
- `just test` - run test suite (from `backend/` directory)
- `gh issue list` - check open issues
## admin tooling

### content moderation
script: `scripts/delete_track.py`
- requires `ADMIN_*` prefixed environment variables
- deletes audio file from R2
- deletes cover image from R2 (if exists)
- deletes database record (cascades to likes and queue entries)
- notes ATProto records for manual cleanup (can't delete from other users' PDS)

usage:
```bash
# dry run
uv run scripts/delete_track.py <track_id> --dry-run

# delete with confirmation
uv run scripts/delete_track.py <track_id>

# delete without confirmation
uv run scripts/delete_track.py <track_id> --yes

# by URL
uv run scripts/delete_track.py --url https://plyr.fm/track/34
```

required environment variables:
- `ADMIN_DATABASE_URL` - production database connection
- `ADMIN_AWS_ACCESS_KEY_ID` - R2 access key
- `ADMIN_AWS_SECRET_ACCESS_KEY` - R2 secret
- `ADMIN_R2_ENDPOINT_URL` - R2 endpoint
- `ADMIN_R2_BUCKET` - R2 bucket name

## known issues

### non-blocking
- cloudflare pages preview URLs return 404 (production works fine)
- some "relay" references remain in docs and comments
- ATProto like records can't be deleted when removing tracks (orphaned on users' PDS)

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
4. test locally
5. merge to main → deploys to staging automatically
6. verify on staging
7. create github release → deploys to production automatically

### key principles
- type hints everywhere
- lowercase aesthetic
- generic terminology (use "items" not "tracks" where appropriate)
- ATProto first
- mobile matters
- cost conscious
- async everywhere (no blocking I/O)

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
└── justfile              # task runner (mods: backend, frontend, moderation, transcoder)
```

## documentation

- [deployment overview](docs/deployment/overview.md)
- [configuration guide](docs/configuration.md)
- [queue design](docs/queue-design.md)
- [logfire querying](docs/logfire-querying.md)
- [pdsx guide](docs/pdsx-guide.md)
- [neon mcp guide](docs/neon-mcp-guide.md)

---

this is a living document. last updated 2025-12-02.
