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

### April 2026

#### top tracks time-range toggle + like count fix (PRs #1228-1230, Apr 3)

**why**: the homepage "top tracks" section showed all-time most-liked tracks with no way to see recent trends. separately, the artist leaderboard rank feature (play-count-based) rewarded volume uploaders and self-listeners over genuine community engagement — shipped and pulled in the same session.

**what shipped**:
- **period toggle** (#1228): cycling label on "top tracks" heading — "all time" → "past month" → "past week" → "past day" — filters which tracks appear by when their likes were created. selection persists in localStorage. backend `GET /tracks/top?period=month` accepts `all_time|month|week|day`, maps to `since` cutoff on `TrackLike.created_at` (indexed column)
- **like count fix** (#1230): the period filter was reusing the time-scoped like count for display — filtering to "past day" showed "1 like" even if a track had many total likes. now uses period-filtered counts only for ordering/inclusion, fetches all-time totals separately for the displayed `like_count`
- **rank card pulled** (#1229): artist leaderboard rank (top 10 by total plays) shipped in #1228 but immediately pulled from the frontend — the #1 ranked artist was an archiver uploading Internet Archive content and listening to it himself, not a community-recognized artist. backend infrastructure (`rank` field in analytics response, Redis-cached leaderboard) remains intact for re-enabling with better criteria (likely likes-based)

**decisions**:
- play count is a poor ranking signal — it rewards self-listening and volume. likes are better but still raise questions about what "top artist" means on a platform hosting archives, podcasts, ASMR, etc.
- kept the backend rank infrastructure to avoid throwaway work — the leaderboard query and caching are correct, just need a better ranking formula

---

#### browser observability + now-playing flood fix (PRs #1224-1225, Apr 2-3)

**why**: a login redirect failure had zero frontend traces to debug — backend spans showed success, but something broke between the 303 redirect and the frontend. separately, a single user's client hammered `POST /now-playing/` every 5 seconds for an hour (2,758 requests), driving p95 latency to 2.9s and max to 13.6s across the entire API. zero 5xx errors, but the app felt down for everyone.

**what shipped**:
- **browser observability** (#1224): `@pydantic/logfire-browser` SDK auto-instruments fetch, document-load, user-interaction, and XHR. telemetry proxied through `POST /logfire-proxy/{path:path}` on the backend (via `logfire.experimental.forwarding.logfire_proxy`) so the write token stays server-side. `traceparent` headers propagate to the API for distributed tracing — a single trace now spans browser → API → database. service name `plyr-web` distinguishes from backend's `plyr-api` in Logfire
- **now-playing throttle fix** (#1225): the frontend's `progressBucket` rounded to 5 seconds but the throttle interval was 10 seconds — the state fingerprint changed mid-throttle, bypassing the "skip if unchanged" check and firing reports every 5s instead of 10s. aligned bucket granularity to match `REPORT_INTERVAL_MS` (10s). backend: replaced `@limiter.exempt` with `30/minute` rate limit as a server-side safety net (normal playback is 6/min, generous headroom for rapid play/pause/seek)

**incident timeline** (2026-04-02 23:17–23:40 UTC):
- 23:17: traffic spikes to 1,624 requests/minute (10x normal), p95 = 1.6s
- 23:18: 458 requests, p95 = 2.9s, max = 3.0s
- 23:22: second spike, max latency hits 13.6s
- 23:38: third spike, 1,945 requests/minute, max = 7.8s
- 00:00: traffic returns to normal (~30 requests/minute)
- root cause: joebasser.com's client firing `POST /now-playing/` every 5s for ~1 hour

---

#### album AT-URI resolution + search modal polish (PRs #1222-1223, Apr 2)

**what shipped**:
- **album AT-URI fix** (#1223): the `/at/[...uri]` catch-all route only resolved tracks and playlists. album AT-URIs (`fm.plyr.album`) returned 404. refactored the route to use a generic list resolver that handles both playlists and albums through the existing `/lists/*/by-uri` endpoints. added regression tests
- **search modal** (#1222): centered vertically in viewport, enhanced glass effect

---

#### homepage tag filtering + backend performance (PRs #1216-1220, Apr 2)

**why**: the homepage had no way to positively filter tracks by genre. you could hide tags (negative filter) but not say "show me electronic and ambient." the dedicated `/tag/[name]` page only supports one tag and navigates away from the homepage. separately, the `GET /tracks/` endpoint was 250-1200ms for authenticated users due to an uncached external HTTP call to atprotofans.com for supporter validation on every single request.

**what shipped**:
- **tag filter chips**: horizontal scrollable row of popular tag chips below "latest tracks." multi-select with OR logic (tracks matching any selected tag). per-tag hue colors via deterministic hash. selected tags sort to the left. selection persists in localStorage across page refreshes
- **backend `tags` query param**: `GET /tracks/?tags=electronic&tags=ambient` filters to tracks matching any selected tag. composes with hidden tag filtering. skips Redis cache when tags are active
- **tag ranking by plays**: tags are now ordered by total play count (sum of `play_count` across all tracks with that tag) instead of just track count. surfaces genres with actual listener engagement
- **atprotofans Redis cache**: supporter validation results cached in Redis with 5-min TTL per (supporter, artist) pair. eliminates the 80-1100ms external HTTP call on repeat page loads
- **parallelized supporter validation**: `asyncio.create_task()` kicks off the atprotofans call immediately after getting the track list, running concurrently with batch aggregations (~19ms), PDS resolution (~58ms), and image resolution. previously these all ran sequentially

**performance impact** (authenticated users, production):
- before: 250-1200ms (validate_supporter was 82% of request time on slow calls)
- after (cache miss): ~170ms (validate_supporter runs in parallel with other work)
- after (cache hit): ~170ms (no external call at all)

---

#### Fly HTTP health checks + outage retro (PR #1214, Apr 2)

**why**: production outage (~6 min, 02:34-02:40 UTC Apr 2). after a deploy, Fly auto-stopped one machine for low traffic. the remaining machine became unresponsive but Fly had no health checks configured — it kept reporting the machine as "started" while it served nothing. when a replacement machine finally started, it was OOM killed (1GB exhausted in 20 seconds from queued request burst). manual `fly machine restart` was required to recover.

**what shipped**:
- added `[[http_service.checks]]` to both `fly.toml` and `fly.staging.toml` — Fly now polls `GET /health` every 10s with a 5s timeout and 30s startup grace period
- Fly will auto-restart machines that stop responding, eliminating the class of outage where a frozen process goes undetected

**what we learned**:
- the Dec 2025 database pool fixes (pool_size=10, max_overflow=5, connection_timeout=10s) were already in place — initial analysis incorrectly blamed stale recommendations
- the queue listener is already decoupled from the app lifecycle (`asyncio.create_task`, catches all exceptions) — it was not the cause of the process death
- what actually froze the remaining machine is still unknown (no Logfire output for 6 minutes while Fly reported it as "started"). possible causes: memory pressure on 1GB VM, blocked event loop, or a hard crash whose Fly event was truncated from the 5-event log
- full retro: `sandbox/retrospectives/2026-04-02-deploy-outage-oom-kill.md`

---

#### AT-URI top-level route resolution (PRs #1206, #1208, Apr 1)

**why**: every atproto app should support AT-URIs as top-level routes ([streamplace/streamplace#1012](https://github.com/streamplace/streamplace/issues/1012)). this lets anyone paste `https://plyr.fm/at://did:plc:xxx/fm.plyr.track/rkey` and land on the right page.

**what shipped**:
- new SvelteKit catch-all route at `/at/[...uri]` that parses AT-URIs via `AtUri` from `@atproto/api`, resolves them against existing backend `/tracks/by-uri` and `/lists/playlists/by-uri` endpoints, and 301 redirects to the canonical page (`/track/{id}`, `/playlist/{id}`)
- handles browser normalization of `://` in URL paths
- follow-up (#1208): replaced 7 instances of manual `.split("/")` AT-URI parsing across backend and frontend with proper library utilities (`parse_at_uri()` wrapper in Python, `AtUri` class in TypeScript)

---

#### track detail page: title width + metadata disclosure (PR #1205, Apr 1)

**why**: long track titles like "better hate (jessica pratt cover)" wrapped onto two lines because `.track-info-wrapper` was capped at `max-width: 600px`. the inline description also added visual weight without user opt-in.

**what shipped**:
- widened `.track-info-wrapper` from `max-width: 600px` to `min(900px, 90%)` — long titles stay on one line on desktop, 90% prevents edge-touching on narrower viewports
- replaced the inline collapsible description (gradient mask + "show more/less" toggle) with a circled `(i)` icon in the stats row that slides open a metadata panel on click. only renders when `track.description` exists

---

#### WebSocket hardening (PRs #1203-1204, Apr 1)

**what shipped**:
- **security** (#1203): origin validation rejects WebSocket upgrades from non-allowlisted origins, `session_id` omitted from client-facing messages
- **reliability** (#1204): idle timeout disconnects inactive connections, per-IP rate limiting and connection limits prevent abuse

---

#### Jetstream identity sync + image URL fix (PRs #1200-1202, Mar 31)

**what shipped**:
- **handle sync** (#1200): Jetstream identity events now trigger handle updates — when an artist changes their handle on Bluesky, plyr.fm picks it up automatically instead of waiting for their next sign-in
- **image URL fix** (#1202): R2 storage keys use the original file extension, but the image URL construction wasn't preserving it. images uploaded as `.jpeg` were served with `.jpg` URLs (or vice versa), returning 404s from R2
- **docs homepage** (#1201): pinned track 778 on docs homepage, deduplicated tracks-by-artist in the showcase

---

### March 2026

See `.status_history/2026-03.md` for detailed history.

---

### February 2026

See `.status_history/2026-02.md` for detailed history.

---

### January 2026

See `.status_history/2026-01.md` for detailed history.

### December 2025

See `.status_history/2025-12.md` for detailed history.

### November 2025

See `.status_history/2025-11.md` for detailed history.

## priorities

### current focus

Top tracks time-range toggle shipped (#1228-1230) — homepage "top tracks" now cycles through all-time/month/week/day filters. artist leaderboard rank shipped and pulled in the same session (#1228-1229) — play count rewards volume, not engagement. backend rank infrastructure kept for re-enabling with likes-based criteria. next: define what "top artist" means on a platform with diverse content types; monitor browser telemetry volume (add sampling if needed); add a staging environment for the moderation service (#1165).

### known issues
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- harden file format support — revisit transcoding pipeline (FLAC graduated in #1189, AIFF still transcodes)
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable rules engine for moderation (Osprey rules engine PR #958 — on hold pending infrastructure consolidation, see #907)
- infrastructure consolidation — audit and migrate from Fly.io sprawl to Helm/K8s pattern (#907, reference: `../relay`)
- time-release gating (#642)
- social activity feed (#971)

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
- ✅ lossless audio (AIFF/FLAC) with automatic transcoding for browser compatibility
- ✅ PDS blob storage for audio (user data ownership)
- ✅ play count tracking, likes, queue management
- ✅ unified search with Cmd/Ctrl+K (keyword + mood search in parallel)
- ✅ mood search via CLAP embeddings + turbopuffer (feature-flagged)
- ✅ teal.fm scrobbling
- ✅ copyright moderation with ATProto labeler
- ✅ ML genre classification with suggested tags in edit modal + auto-tag at upload (Replicate effnet-discogs)
- ✅ docket background tasks (copyright scan, export, atproto sync, scrobble, genre classification)
- ✅ media export with concurrent downloads
- ✅ supporter-gated content via atprotofans
- ✅ listen receipts (tracked share links with visitor/listener stats)
- ✅ jams — shared listening rooms with real-time sync via Redis Streams + WebSocket
- ✅ 96x96 WebP thumbnails for artwork (track, album, playlist)

**albums**
- ✅ album CRUD with cover art
- ✅ ATProto list records (auto-synced on login)

**playlists**
- ✅ full CRUD with drag-and-drop reordering
- ✅ ATProto list records (synced on create/modify)
- ✅ "add to playlist" menu, global search results
- ✅ inline track recommendations when editing (CLAP embeddings + adaptive RRF/k-means)

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

- fly.io (backend + redis + transcoder + moderation): ~$24/month
- neon postgres: $5/month
- cloudflare (R2 + pages + domain): ~$1/month
- copyright scanning (AuDD): ~$5-10/month
- replicate (genre classification): <$1/month (scales to zero, ~$0.00019/run)
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

see the [contributing guide](https://docs.plyr.fm/contributing/) for setup instructions, or install the [contribute skill](.claude/skills/contribute/SKILL.md) for AI coding assistants.

## documentation

- **public docs**: [docs.plyr.fm](https://docs.plyr.fm) — for listeners, artists, developers, and contributors
- **internal docs**: [docs/internal/](docs/internal/) — deployment, auth internals, runbooks, moderation
- **lexicons**: [docs.plyr.fm/lexicons/overview](https://docs.plyr.fm/lexicons/overview/) — ATProto record schemas

---

this is a living document. last updated 2026-04-03 (top tracks period toggle, artist rank pulled).

