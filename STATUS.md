# plyr.fm - status update

Status as of: 2025-11-18

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

## medium-term vision (next 3-6 months)

### core feature priorities

1. **rich track metadata** (#155)
   - genres, tags, descriptions
   - enhanced discoverability
   - proper music taxonomy

2. **audio transcoding pipeline** (#153)
   - support AIFF/AIF and other formats
   - automatic conversion to web-friendly formats
   - consistent playback experience

3. **PWA installability** (#165)
   - desktop and mobile installation
   - offline capability exploration
   - native app-like experience

4. **fullscreen player view** (#122)
   - immersive playback interface
   - album art showcase
   - enhanced mobile experience

### platform maturity

1. **content moderation** (#166, #167)
   - image content moderation for user uploads
   - DMCA safe harbor compliance
   - automated detection systems

2. **public developer API** (#56)
   - versioned REST API
   - authentication patterns
   - rate limiting and quotas
   - documentation and SDKs

3. **content-addressable storage** (#146)
   - hash-based URLs for deduplication
   - bandwidth optimization
   - cache-friendly architecture

### ecosystem integration

- deeper ATProto federation
- cross-client compatibility testing
- Bluesky social sharing improvements
- PDS integration patterns

## current state

**production is live and gaining real users** 🎉
- latest release: 2025.1110.042349
- frontend: https://plyr.fm
- backend: https://relay-api.fly.dev
- three-tier deployment working: dev → staging → production
- first external user (@stellz) actively uploading content (75+ minute tracks tested successfully)

## short-term priorities (this week)

### active issues

1. **playback auto-start on refresh** (#225)
   - symptom: page refresh sometimes starts playing immediately
   - suspected cause: client-side caching of playback state or queue restoration
   - `autoplay_next` preference set to false but not always respected
   - needs investigation into what state is persisting and why

2. **liquid glass visual effects** (#186)
   - user-configurable frosted glass effects
   - aesthetic enhancement feature
   - low priority, high polish

## recent work (november 2025)

### summary

**major features**:
- ✅ ATProto namespace separation (#263-264) - environment-specific namespaces, removed hardcoded strings, migrated staging data
- ✅ secure browser authentication (#237, #239, #244) - HttpOnly cookies, XSS protection, environment-aware configuration
- ✅ albums feature (PRs #214-222) - database schema, CRUD, browsing, detail pages, cover art
- ✅ frontend data loading overhaul (PRs #210, #227) - server-side rendering, centralized auth
- ✅ link preview system (PRs #230-231) - rich OG metadata for albums, homepage, tracks
- ✅ liked tracks feature (#157) - persistent collections with ATProto records
- ✅ transcoder API service (#156) - standalone Rust service for AIFF/FLAC→MP3 conversion
- ✅ track detail pages (#164) - dedicated pages with large cover art

**data integrity fixes** (PR #191, Nov 13, 2025):
- ✅ duplicate upload detection - prevents re-uploading same file from creating multiple tracks pointing to shared R2 object
- ✅ refcount-based R2 deletion - only deletes R2 files when refcount = 1, prevents breaking other tracks
- ✅ ATProto cleanup on delete - removes PDS records when tracks deleted, prevents orphaned records
- ✅ exact key deletion - uses stored `file_type` to delete precise R2 key instead of guessing extensions

**performance improvements**:
- ✅ eliminated N+1 R2 API calls (#184) - store image URLs in database
- ✅ async I/O throughout backend (#149-151) - async R2 operations, concurrent PDS resolution, async storage writes
- ✅ queue hydration optimization - per-session token locks prevent race conditions

**reliability & UX**:
- ✅ streaming uploads with progress (#182, #282) - prevents OOM, better mobile experience
- ✅ graceful ATProto recovery (#180) - tracks with missing records can self-restore
- ✅ mobile UI polish (#159-185) - consistent layouts, better touch targets, improved navigation
- ✅ wave loading animation (#283) - music-themed loading states, clickable refresh on homepage
- ✅ share action parity - added artist detail share button with mobile-friendly placement for consistent copying behavior across track/album/artist pages

**security & validation**:
- ✅ origin validation for image URLs (#168)
- ✅ AIFF/AIF format rejection (#152) - prevents browser compatibility issues

### detailed history

### wave loading animation (PR #283, Nov 18, 2025)

**motivation**: loading states across the app used inconsistent text ("loading...", "loading tracks...") or generic spinners. wanted a distinctive, music-themed animation that reflects the platform's aesthetic and provides visual consistency.

**what shipped**:
- **WaveLoading component**: new loading animation with 5 vertical bars that pulse in sequence like an audio equalizer
  - configurable sizes: sm (16px), md (24px), lg (32px)
  - uses accent color for brand consistency
  - optional message text below animation
  - smooth ease-in-out animations for polish
- **replaced all loading states**:
  - homepage: added `initialLoad` state to prevent "no tracks yet" flash before data loads
  - portal: main loading + tracks/albums sections
  - broken tracks: replaced LoadingSpinner with WaveLoading
- **clickable refresh**: "latest tracks" heading on homepage now interactive
  - click to force fresh data fetch (bypasses cache)
  - hover effect shows it's clickable
  - simple way for users to check for new content
- **cleanup**: deleted unused LoadingSpinner and LoadingOverlay components

**design rationale**:
- wave pattern chosen as music-themed visual metaphor (like audio visualizer)
- vertical bars instead of horizontal to save space and work well in narrow layouts
- staggered animation (0.1s delay per bar) creates smooth wave effect
- accent color ties to brand identity
- kept intentionally simple - can enhance later with more bars, color variations, or audio responsiveness

**impact**:
- ✅ consistent loading experience across entire app
- ✅ on-brand visual identity (music-themed)
- ✅ eliminated "no tracks yet" flash on homepage
- ✅ users can manually refresh latest tracks
- ✅ net code reduction (-10 lines: +112 new, -122 removed)

**future enhancements** (optional):
- could add more bars for fuller effect
- could vary colors or respond to playing audio
- could add particle effects or other visual flourishes
- established pattern for future loading states

### ATProto namespace separation (PRs #263-264, Nov 17, 2025)

**motivation**: dev and staging environments were writing ATProto records to production `fm.plyr.*` namespace, polluting production collections with test data. namespace configuration was also hardcoded in multiple places instead of using environment-aware config.

**what shipped**:
- **removed hardcoded namespaces** (PR #263):
  - replaced hardcoded `"fm.plyr.like"` strings in `src/backend/_internal/atproto/records.py`
  - added `like_collection` computed field to config (mirrors existing `track_collection`)
  - fixed OAuth scope generation to use computed fields instead of hardcoded strings
  - updated `scripts/backfill_atproto_records.py` to use settings (was using hardcoded namespace)
- **environment-specific namespaces**:
  - development: `fm.plyr.dev` (local .env)
  - staging: `fm.plyr.stg` (flyctl secrets)
  - production: `fm.plyr` (flyctl secrets)
- **data migration**:
  - migrated 7 tracks + 5 likes from `fm.plyr.*` to `fm.plyr.dev.*` in development
  - migrated 7 tracks + 5 likes from `fm.plyr.*` to `fm.plyr.stg.*` in staging
  - used combination of automated script + manual cleanup with neon MCP and pdsx
  - cleaned up old staging records from production namespace
- **documentation** (PR #264):
  - updated `docs/deployment/environments.md` with namespace configuration
  - updated `docs/backend/configuration.md` with environment-specific examples
  - removed typer from project dependencies (moved to PEP 723 inline script deps)
  - created `sandbox/stg-namespace-migration/README.md` documenting migration process

**impact**:
- ✅ test tracks/likes no longer pollute production collections
- ✅ OAuth scopes environment-specific and automatically generated from config
- ✅ database and ATProto records stay aligned within each environment
- ✅ proper data separation for dev/staging/production environments
- ✅ eliminated hardcoded namespace strings throughout codebase

**lessons learned**:
- PEP 723 inline script dependencies work well for ad-hoc migration scripts
- database as source of truth more reliable than PDS for stale record lookups
- manual cleanup sometimes faster than debugging complex migration logic

**follow-up cleanup** (Nov 18, 2025):
- discovered 82 orphaned test/dev records remaining in production `fm.plyr.track` namespace
- created analysis script (`scripts/identify_orphaned_records.py`) to cross-reference PDS records against production database
- verified all 13 production tracks safe (including critical tracks: webhook with features, dinah, lil blues improv)
- automated deletion via generated script with proper PDS authentication
- result: 95 → 13 records in production namespace, all production data intact
- filed upstream issue ([pdsx#43](https://github.com/zzstoatzz/pdsx/issues/43)) for batch/concurrent CRUD operations

### mobile UI polish (PRs #259-261, #265, #268, Nov 17, 2025)

**serialization improvements** (PRs #259-260):
- created `TrackResponse` Pydantic model for consistent track serialization
- fixed album endpoint to properly serialize tracks (was mixing dict/model types)
- eliminated manual dict construction in favor of model-based serialization
- better type safety and consistency across endpoints

**notifications fix** (PR #261):
- notification bot was using hardcoded `https://plyr.fm` URL
- now uses environment-aware `settings.frontend.url` (staging uses `https://stg.plyr.fm`)
- ensures notifications link to correct environment

**sticky player padding** (PRs #265, #268):
- fixed album tracks overlapping with sticky bottom player on mobile (#265)
- attempted centralized padding approach (#266) but created excessive whitespace on mobile
- reverted to per-page padding handling (#268) while keeping album track clearance fix
- mobile padding now matches pre-centralization behavior

**impact**:
- ✅ consistent track serialization across all endpoints
- ✅ notifications link to correct environment
- ✅ album tracks properly clear sticky player on mobile
- ✅ mobile padding back to appropriate levels (no excessive whitespace)

### secure browser authentication (issue #237, PRs #239-244, Nov 14-15, 2025)

**motivation**: session tokens stored in localStorage were vulnerable to XSS attacks. any malicious script could read `session_id` from localStorage and hijack accounts for the full 14-day session lifetime.

**what shipped**:
- **HttpOnly cookies** (PR #244): backend sets `Set-Cookie: session_id=...; HttpOnly; Secure; SameSite=Lax`
  - HttpOnly prevents JavaScript access (XSS protection)
  - Secure requires HTTPS (except localhost for dev)
  - SameSite=Lax prevents CSRF while allowing same-site requests
  - cookies automatically sent with requests (no manual auth header management)
- **cookie-aware auth dependencies** (PR #243):
  - `require_auth` checks cookies first, falls back to Authorization header
  - `require_artist_profile` updated with same pattern
  - optional auth endpoints (tracks list, track detail, album detail) now support cookies
  - proper parameter aliasing (`Cookie(alias="session_id")`) for FastAPI
- **environment-aware cookie configuration**:
  - localhost: `secure=False` for HTTP development
  - staging/production: `secure=True` for HTTPS
  - no explicit domain set (prevents cross-environment session leakage)
- **same-site detection**:
  - compares origin host vs request host
  - uses `SameSite=lax` when same-site (localhost→localhost, stg.plyr.fm→api-stg.plyr.fm)
  - prevents cookies from being sent cross-site
- **frontend cleanup** (PR #239):
  - removed all localStorage session_id read/write operations
  - removed `getSessionId()`, `setSessionId()`, `getAuthHeaders()` helpers
  - all fetch calls use `credentials: 'include'` to send cookies
  - `XMLHttpRequest` uses `withCredentials: true`
  - auth state now managed entirely by backend via HttpOnly cookies

**environment architecture**:
- all environments use custom domains on same eTLD+1 for cookie sharing:
  - **staging**: `stg.plyr.fm` → `api-stg.plyr.fm` (both `.plyr.fm`)
  - **production**: `plyr.fm` → `api.plyr.fm` (both `.plyr.fm`)
  - **local**: `localhost:5173` → `localhost:8001` (both `localhost`)
- separate cloudflare pages projects prevent staging/production cookie conflicts:
  - `plyr-fm-stg` for staging (tracks `main` branch)
  - `plyr-fm` for production (tracks `production-fe` branch)

**security improvements**:
- ✅ eliminated XSS session hijacking vector
- ✅ tokens no longer accessible to JavaScript
- ✅ CSRF protection via SameSite=Lax
- ✅ secure transport enforcement (HTTPS in production)
- ✅ environment isolation (no cookie sharing between staging/prod)

**compatibility maintained**:
- browser clients: use HttpOnly cookies automatically
- future SDK/CLI clients: can still use `Authorization: Bearer <token>` header
- backend accepts both cookie and header auth (cookie preferred)

**documentation created**:
- `docs/backend/atproto-identity.md`: ATProto OAuth client metadata discovery patterns
- `docs/deployment/environments.md`: updated with staging/production cookie architecture
- PR #243 description: comprehensive explanation of cookie domain behavior

**impact**:
- closed high-priority security issue #237
- production-grade auth implementation
- foundation for future session management features (device tracking, forced logout)
- eliminated most common web application security vulnerability

### albums feature (PRs #214-222, Nov 13-14, 2025)

**motivation**: users wanted to group tracks into albums with dedicated pages, cover art, and metadata.

**what shipped**:
- **database schema** (PR #222): new `albums` table with title, slug, description, image_id, artist_did
  - album-track relationship via `album_rel` on tracks table
  - migration to backfill albums from existing track `extra->>'album'` metadata
  - 8 albums created from existing 32 tracks in production
- **backend CRUD** (PR #222): full album management endpoints
  - `GET /albums/{handle}` - list artist's albums
  - `GET /albums/{handle}/{slug}` - album detail with tracks
  - `POST /albums` - create album (authenticated)
  - `PATCH /albums/{id}` - update album metadata
  - album cover art upload and storage in R2
- **frontend pages** (PRs #214, #216-220):
  - album detail pages (`/u/{handle}/album/{slug}`) with track lists
  - artist discography sections on artist pages
  - album cover art display throughout UI
  - server-side rendering for SEO and link previews
- **UI polish** (PR #228): long album title handling
  - 100-character slug limit with word-boundary truncation
  - CSS text truncation for inline album links
  - proper wrapping for album detail page titles
  - tested with 91-character production album title
- **link previews** (PRs #230-231):
  - rich Open Graph metadata for albums (music.album type)
  - artist musician property, image dimensions, canonical URLs
  - fixed layout metadata conflicts (prevented generic tags from overriding page-specific ones)

**what's NOT done** (issue #221 still open):
- ATProto records for albums (consciously deferred)
- reason: want to thoughtfully design the lexicon before committing to a schema
- tracks work fine without album ATProto records for now

**impact**:
- albums now first-class citizens in UI and database
- better content organization for artists with multiple releases
- improved SEO with album-specific link previews
- foundation for future features (album likes, album playlists)

### frontend architecture improvements (PRs #210, #227, Nov 13-14, 2025)

**motivation**: eliminate "flash of loading", improve SEO, reduce code duplication, fix performance bottlenecks.

**PR #210 - centralized auth and client-side load functions**:
- created `lib/auth.svelte.ts` - centralized auth manager with SSR-safe guards
- added `+layout.ts` - loads auth state once for entire app
- added `+page.ts` to liked tracks page - loads data before component mounts
- refactored all pages to use centralized auth (eliminated scattered localStorage calls)
- code reduction: +256 lines, -308 lines (net -52 lines)

**PR #227 - artist pages moved to server-side rendering**:
- replaced client-side `onMount` fetches with `+page.server.ts`
- parallel server loading of artist info, tracks, and albums
- data ready before page renders (eliminates loading states)
- performance: ~1.66s sequential waterfall → instant render

**pattern shift**:
```
old: page loads → onMount → fetch artist → fetch tracks → fetch albums → render
new: server fetches all in parallel → page renders immediately with data
```

**impact**:
- eliminated "flash of loading" across artist and album pages
- improved lighthouse scores and SEO (real data in initial HTML)
- consistent auth patterns throughout app
- better UX - pages feel instant instead of progressive

**documentation**: see `docs/frontend/data-loading.md` for patterns and anti-patterns

### link preview system (PRs #230-231, Nov 14, 2025)

**problem**: album pages and homepage had no Open Graph metadata, leading to poor link previews on social media.

**PR #230 - add rich metadata**:
- homepage: complete OG tags (type, title, description, url, site_name)
- album pages: rich music.album metadata matching track page quality
  - added canonical URL, site name, musician property
  - added image dimensions (1200x1200), alt text, secure_url
  - improved meta description

**PR #231 - fix metadata conflicts**:
- root layout was rendering duplicate OG tags on all pages
- social scrapers use first tags encountered (generic layout ones)
- page-specific metadata was being ignored
- solution: exclude pages with their own metadata from layout defaults
  - homepage (`/`)
  - track pages (`/track/*`)
  - album pages (`/u/*/album/*`)

**result**: album links now show rich previews with cover art, artist info, track counts when shared on social platforms.

### Banana mix incident fixes (PR #191, Nov 13, 2025)

**Why:** stellz uploaded "banana mix" twice due to slow UI feedback, creating duplicate tracks (56 and 57)
pointing to the same R2 file. When track 57 was deleted, it removed the shared R2 file, breaking track 56
with 404 errors. ATProto record for track 57 was orphaned on her PDS. Investigation also revealed storage
layer was guessing file extensions by trying all formats until finding a match.

**What shipped:**
- **duplicate detection** (tracks.py:181-203): after saving file, checks if track with same `file_id`
  and `artist_did` exists. rejects upload with error instead of creating duplicate.
- **refcount-based deletion** (r2.py:175-197): before deleting R2 file, queries database for refcount.
  only deletes if `refcount == 1`. logs when deletion skipped due to `refcount > 1`.
- **exact key deletion** (r2.py:163-233, filesystem.py:85-123): updated `delete()` signature to accept
  optional `file_type` parameter. when provided, deletes exact key `audio/{file_id}.{file_type}` instead
  of looping through all formats. fallback to loop only when `file_type` is None (legacy rows, images).
  - upload cleanup passes `audio_format.value`
  - track deletion passes `track.file_type`
  - image deletion still uses fallback (no `image_format` field yet - tech debt)
- **ATProto cleanup** (tracks.py:683-712): deletes PDS record when track deleted. handles 404 gracefully
  (record already gone), bubbles other errors.

**Impact:** prevents "delete duplicate and nuke original" scenario. logs show exact keys being deleted
instead of trying wrong extensions first. manual e2e test confirmed: uploaded .wav file, verified exact
key deletion via R2 API, confirmed clean deletion with no orphans in DB/PDS/R2.

**Tech debt identified:**
- storage layer has accumulated naive patterns that work but aren't elegant:
  - image deletion still loops through formats (no `image_format` column on tracks)
  - could store image format alongside `image_id` to enable exact deletion
  - or maintain separate image metadata table
  - functional for now, but should clean up later

### detailed history

### Queue hydration + ATProto token hardening (Nov 12, 2025)

**Why:** queue endpoints were occasionally taking 2s+ and restore operations could 401
when multiple requests refreshed an expired ATProto token simultaneously.

**What shipped:**
- Added persistent `image_url` on `Track` rows so queue hydration no longer probes R2
  for every track. Queue payloads now pull art directly from Postgres, with a one-time
  fallback for legacy rows.
- Updated `_internal/queue.py` to backfill any missing URLs once (with caching) instead
  of per-request GETs.
- Introduced per-session locks in `_refresh_session_tokens` so only one coroutine hits
  `oauth_client.refresh_session` at a time; others reuse the refreshed tokens. This
  removes the race that caused the batch restore flow to intermittently 500/401.

**Impact:** queue tail latency dropped back under 500 ms in staging tests, ATProto
restore flows are now reliable under concurrent use, and Logfire no longer shows 500s
from the PDS.

### Liked tracks feature (PR #157, Nov 11, 2025)

- ✅ server-side persistent collections
- ✅ ATProto record publication for cross-platform visibility
- ✅ UI for adding/removing tracks from liked collection
- ✅ like counts displayed in track responses and analytics (#170)
- ✅ analytics cards now clickable links to track detail pages (#171)
- ✅ liked state shown on artist page tracks (#163)

### Upload streaming + progress UX (PR #182, Nov 11, 2025)

- Frontend switched from `fetch` to `XMLHttpRequest` so we can display upload progress
  toasts (critical for >50 MB mixes on mobile).
- Upload form now clears only after the request succeeds; failed attempts leave the
  form intact so users don't lose metadata.
- Backend writes uploads/images to temp files in 8 MB chunks before handing them to the
  storage layer, eliminating whole-file buffering and iOS crashes for hour-long mixes.
- Deployment verified locally and by rerunning the exact repro Stella hit (85 minute
  mix from mobile).

### transcoder API deployment (PR #156, Nov 11, 2025)

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

### AIFF/AIF browser compatibility fix (PR #152, Nov 11, 2025)

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

### async I/O performance fixes (PRs #149-151, Nov 10-11, 2025)

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

### cover art support (PRs #123-126, #132-139)
- ✅ track cover image upload and storage (separate R2 bucket)
- ✅ image display on track pages and player
- ✅ Open Graph meta tags for track sharing
- ✅ mobile-optimized layouts with cover art
- ✅ sticky bottom player on mobile with cover

### track detail pages (PR #164, Nov 12, 2025)

- ✅ dedicated track detail pages with large cover art
- ✅ play button updates queue state correctly (#169)
- ✅ liked state loaded efficiently via server-side fetch
- ✅ mobile-optimized layouts with proper scrolling constraints
- ✅ origin validation for image URLs (#168)

### mobile UI improvements (PRs #159-185, Nov 11-12, 2025)

- ✅ compact action menus and better navigation (#161)
- ✅ improved mobile responsiveness (#159)
- ✅ consistent button layouts across mobile/desktop (#176-181, #185)
- ✅ always show play count and like count on mobile (#177)
- ✅ login page UX improvements (#174-175)
- ✅ liked page UX improvements (#173)
- ✅ accent color for liked tracks (#160)

### queue management improvements (PRs #110-113, #115)
- ✅ visual feedback on queue add/remove
- ✅ toast notifications for queue actions
- ✅ better error handling for queue operations
- ✅ improved shuffle and auto-advance UX

### infrastructure and tooling
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

### critical bugs
1. **upload reliability** (issue #147): upload returns 200 but file missing from R2, no error logged
   - priority: high (data loss risk)
   - need better error handling and retry logic in background upload task

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

6. **liked tracks feature** (issue #144): design schema and ATProto record format
   - server-side persistent collections
   - ATProto record publication for cross-platform visibility
   - UI for adding/removing tracks from liked collection

## open issues by timeline

### immediate
- issue #153: audio transcoding pipeline (ffmpeg worker for AIFF/FLAC→MP3)
- issue #147: upload reliability bug (data loss risk)
- issue #144: likes feature for personal collections

### short-term
- issue #146: content-addressable storage (hash-based deduplication)
- issue #24: implement play count abuse prevention
- database connection pool tuning (SSL errors)
- file extension persistence in database

### medium-term
- issue #39: postmortem - cross-domain auth deployment and remaining security TODOs
- issue #46: consider removing init_db() from lifespan in favor of migration-only approach
- issue #56: design public developer API and versioning
- issue #57: support multiple audio item types (voice memos/snippets)
- issue #122: fullscreen player for immersive playback

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

### what's working

**core functionality**
- ✅ ATProto OAuth 2.1 authentication with encrypted state
- ✅ secure session management via HttpOnly cookies (XSS protection)
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
- ✅ admin content moderation script for removing inappropriate uploads

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
- content moderation systems (#166, #167)
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
- no public API for third-party integrations (#56)

**technical debt**
- multi-tab playback synchronization could be more robust
- queue state conflicts can occur with rapid operations
- no automated content moderation yet
- no DMCA compliance workflow

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
- **latest release**: 2025.1110.042349

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
1. player race condition was attempted but reverted (PR #187)
2. main branch is clean and deployable
3. current branch: fix/player-rapid-click-race-condition (can be deleted)
4. focus should be on understanding what broke with the race condition fix
5. liquid glass effects (#186) is a nice-to-have enhancement

**debugging resources:**
- Logfire telemetry: logfire-us.pydantic.dev/zzstoatzz/relay
- recent work documented in: sandbox/double-loading-analysis.md
- relevant code: frontend/src/lib/components/Player.svelte, frontend/src/lib/queue.svelte.ts

**useful commands:**
- `just serve` - run backend
- `just dev` - run frontend
- `just test` - run test suite
- `date` - get current time (don't assume, always check)
- `git log --oneline -20` - see recent work
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
├── src/backend/           # fastapi backend
│   ├── api/              # public HTTP endpoints
│   ├── _internal/        # internal services
│   ├── atproto/          # ATProto integration
│   ├── models/           # sqlalchemy schemas
│   ├── storage/          # R2 and filesystem backends
│   └── utilities/        # helpers and config
├── frontend/             # sveltekit app
│   ├── src/lib/         # components and stores
│   └── src/routes/      # pages
├── tests/               # pytest suite
├── alembic/             # database migrations
├── docs/                # deployment guides
├── .github/workflows/   # CI/CD pipelines
└── CLAUDE.md           # project instructions
```

## documentation

- [deployment overview](docs/deployment/overview.md)
- [configuration guide](docs/configuration.md)
- [queue design](docs/queue-design.md)
- [logfire querying](docs/logfire-querying.md)
- [pdsx guide](docs/pdsx-guide.md)
- [neon mcp guide](docs/neon-mcp-guide.md)

## performance optimization session (Nov 12, 2025)

### issue: slow /tracks/liked endpoint

**symptoms**:
- `/tracks/liked` taking 600-900ms consistently
- only ~25ms spent in database queries
- mysterious 575ms gap with no spans in Logfire traces
- endpoint felt sluggish compared to other pages

**investigation**:
- examined Logfire traces for `/tracks/liked` requests
- found 5-6 liked tracks being returned per request
- DB queries completing fast (track data, artist info, like counts all under 10ms each)
- noticed R2 storage calls weren't appearing in traces despite taking majority of request time

**root cause**:
- PR #184 added `image_url` column to tracks table to eliminate N+1 R2 API calls
- new tracks (uploaded after PR) have `image_url` populated at upload time ✅
- legacy tracks (15 tracks uploaded before PR) had `image_url = NULL` ❌
- fallback code called `track.get_image_url()` for NULL values
- `get_image_url()` makes uninstrumented R2 `head_object` API calls to find image extensions
- each track with NULL `image_url` = ~100-120ms of R2 API calls per request
- 5 tracks × 120ms = ~600ms of uninstrumented latency

**why R2 calls weren't visible**:
- `storage.get_url()` method had no Logfire instrumentation
- R2 API calls happening but not creating spans
- appeared as mysterious gap in trace timeline

**solution implemented**:
1. created `scripts/backfill_image_urls.py` to populate missing `image_url` values
2. ran script against production database with production R2 credentials
3. backfilled 11 tracks successfully (4 already done in previous partial run)
4. 3 tracks "failed" but actually have non-existent images (optional, expected)
5. script uses concurrent `asyncio.gather()` for performance

**key learning: environment configuration matters**:
- initial script runs failed silently because:
  - script used local `.env` credentials (dev R2 bucket)
  - production images stored in different R2 bucket (`images-prod`)
  - `get_url()` returned `None` when images not found in dev bucket
- fix: passed production R2 credentials via environment variables:
  - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
  - `R2_IMAGE_BUCKET=images-prod`
  - `R2_PUBLIC_IMAGE_BUCKET_URL=https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev`

**results**:
- before: 15 tracks needed backfill, causing ~600-900ms latency on `/tracks/liked`
- after: 13 tracks populated with `image_url`, 3 legitimately have no images
- `/tracks/liked` now loads with 0 R2 API calls instead of 5-11
- endpoint feels "really, really snappy" (user feedback)
- performance improvement visible immediately after backfill

**database cleanup: queue_state table bloat**:
- discovered `queue_state` had 265% bloat (53 dead rows, 20 live rows)
- ran `VACUUM (FULL, ANALYZE) queue_state` against production
- result: 0 dead rows, table clean
- configured autovacuum for queue_state to prevent future bloat:
  - frequent updates to this table make it prone to bloat
  - should tune `autovacuum_vacuum_scale_factor` to 0.05 (5% vs default 20%)

**endpoint performance snapshot** (post-fix, last 10 minutes):
- `GET /tracks/`: 410ms (down from 2+ seconds)
- `GET /queue/`: 399ms (down from 2+ seconds)
- `GET /tracks/liked`: now sub-200ms (down from 600-900ms)
- `GET /preferences/`: 200ms median
- `GET /auth/me`: 114ms median
- `POST /tracks/{track_id}/play`: 34ms

**PR #184 context**:
- PR claimed "opportunistic backfill: legacy records update on first access"
- but actual implementation never saved computed `image_url` back to database
- fallback code only computed URLs on-demand, didn't persist them
- this is why repeated visits kept hitting R2 API for same tracks
- one-time backfill script was correct solution vs adding write logic to read endpoints

**graceful ATProto recovery (PR #180)**:
- reviewed recent work on handling tracks with missing `atproto_record_uri`
- 4 tracks in production have NULL ATProto records (expected from upload failures)
- system already handles this gracefully:
  - like buttons disabled with helpful tooltips
  - track owners can self-service restore via portal
  - `restore-record` endpoint recreates with correct TID timestamps
- no action needed - existing recovery system working as designed

**performance metrics pre/post all recent PRs**:
- PR #184 (image_url storage): eliminated hundreds of R2 API calls per request
- today's backfill: eliminated remaining R2 calls for legacy tracks
- combined impact: queue/tracks endpoints now 5-10x faster than before PR #184
- all endpoints now consistently sub-second response times

**documentation created**:
- `docs/neon-mcp-guide.md`: comprehensive guide for using Neon MCP
  - project/branch management
  - database schema inspection
  - SQL query patterns for plyr.fm
  - connection string generation
  - environment mapping (dev/staging/prod)
  - debugging workflows
- `scripts/backfill_image_urls.py`: reusable for any future image_url gaps
  - dry-run mode for safety
  - concurrent R2 API calls
  - detailed error logging
  - production-tested

**tools and patterns established**:
- Neon MCP for database inspection and queries
- Logfire arbitrary queries for performance analysis
- production secret management via Fly.io
- `flyctl ssh console` for environment inspection
- backfill scripts with dry-run mode
- environment variable overrides for production operations

**system health indicators**:
- ✅ no 5xx errors in recent spans
- ✅ database queries all under 70ms p95
- ✅ SSL connection pool issues resolved (no errors in recent traces)
- ✅ queue_state table bloat eliminated
- ✅ all track images either in DB or legitimately NULL
- ✅ application feels fast and responsive

**next steps**:
1. configure autovacuum for `queue_state` table (prevent future bloat)
2. add Logfire instrumentation to `storage.get_url()` for visibility
3. monitor `/tracks/liked` performance over next few days
4. consider adding similar backfill pattern for any future column additions

---

this is a living document. last updated 2025-11-18 after ATProto namespace cleanup.
