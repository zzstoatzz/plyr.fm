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

#### SDK namespace restructure + playlist support (plyr-python-client v0.0.1a16, PR #1293, Apr 13)

**why**: the [plyr-python-client](https://github.com/zzstoatzz/plyr-python-client) SDK, MCP server, and CLI had grown organically as flat methods/commands. the SDK had 17 flat methods on `PlyrClient` (`client.list_tracks()`, `client.like(42)`), the CLI had inconsistent naming (`delete` for tracks but `delete-playlist` for playlists, `tags electronic` returning tracks), and there was no playlist support at all despite the backend having 12 playlist endpoints. a gap analysis ([#24](https://github.com/zzstoatzz/plyr-python-client/issues/24)) identified albums, playlists, artists, discovery, and platform state as uncovered.

**what shipped** ([plyr-python-client#30](https://github.com/zzstoatzz/plyr-python-client/pull/30)):
- **SDK namespace restructure** — flat methods → namespace objects following the OpenAI/Stripe SDK pattern: `client.tracks.list()`, `client.playlists.create()`, `client.discover.search()`, `client.tags.tracks("ambient")`. both sync (`PlyrClient`) and async (`AsyncPlyrClient`) clients have identical namespace APIs, verified by parity tests
- **proper identifier types** — `TrackRef = TrackId | TrackUri` using `Annotated[..., Field(description=...)]`. every track-targeting method accepts either a plyr.fm integer ID or an ATProto URI (`at://did/collection/rkey`), resolved internally. the SDK fetches the track via `/tracks/by-uri` when given a URI, then uses the integer ID for mutation endpoints that require it
- **playlist CRUD** — 9 new SDK methods: `list`, `get`, `create`, `update`, `delete`, `add_track`, `remove_track`, `recommendations`, `by_artist`. `add_track` and `remove_track` accept `TrackRef` and resolve to the ATProto URI/CID needed by the backend's list record operations
- **cyclopts CLI** — migrated from hand-rolled `sys.argv` parsing to [cyclopts](https://cyclopts.readthedocs.io/) with noun-first subcommands: `plyrfm tracks list`, `plyrfm playlists create`, `plyrfm discover search`, `plyrfm tags list`. cyclopts was chosen over click/typer for its `Annotated`-native parameter config, native `int | str` union support (needed for `TrackRef`), and docstring-based help generation
- **MCP server** — updated to use namespace API internally; flat tool names preserved (appropriate for MCP protocol). 4 new read-only playlist tools: `list_playlists`, `get_playlist`, `playlists_by_artist`, `playlist_recommendations`

**decisions**:
- SDK namespaces over flat methods: the namespace pattern (`client.tracks.*`, `client.playlists.*`) groups related operations and prevents naming collisions as the API surface grows (e.g. `tracks.list()` vs `playlists.list()`). the alternative — prefixed flat methods (`list_tracks`, `list_playlists`, `list_albums`) — scales poorly
- `TrackRef` accepts both ID and URI because the SDK serves two audiences: plyr.fm developers (who think in integer IDs) and ATProto ecosystem users (who think in AT-URIs from PDSLS). the SDK resolves internally so neither audience needs to convert
- cyclopts over click: cyclopts uses `Annotated[type, Parameter(...)]` instead of decorators, so command functions remain callable in tests without the framework. it also handles `int | str` unions natively (tries each type left-to-right), which click cannot do
- MCP tool names stayed flat: MCP tools are discovered by name in a flat list — noun-verb namespacing doesn't add value there
- this is a breaking change (flat methods → namespaces, CLI restructure) but the SDK is at `v0.0.1-alpha` so this is expected. the plyr.fm repo's workflow scripts and `llms-full.txt` were updated in #1293

---

#### avatar restore on account reactivation (PR #1291, Apr 13)

**why**: a user deactivated their ATProto account and then reactivated it. their avatar disappeared from plyr.fm during deactivation (the `cdn.bsky.app` URL went dead) and never came back — the jetstream consumer ignored `kind=account` events entirely, and `ingest_identity_update` only refreshed handle + PDS URL, not the avatar.

**what shipped**:
- **`ingest_account_status_change` task** — new docket task dispatched on jetstream `account` events. on deactivation (`active=false`): clears `avatar_url` so the frontend doesn't render a broken image. on reactivation (`active=true`): fetches fresh avatar from the Bluesky public API
- **avatar refresh in `ingest_identity_update`** — identity events (handle changes, PDS migrations) now also re-fetch the avatar from Bluesky. this is belt-and-suspenders with the existing `POST /{did}/refresh-avatar` endpoint (which the frontend calls reactively on 404s)
- **jetstream `account` event handling** — `_process_event` now dispatches `account` events for known DIDs instead of silently skipping them

**decisions**:
- avatar is cleared on deactivation rather than left stale — a broken `cdn.bsky.app` image is worse than no image. the frontend already has fallback rendering for null avatars
- the reactivation path fetches from Bluesky's public API (`app.bsky.actor.getProfile`), same as the existing `fetch_user_avatar()`. if the profile isn't available yet (PDS still syncing), the fetch returns None and the avatar stays cleared until the next identity event or a frontend-triggered refresh

---

#### browser telemetry proxy incident + feed switcher (PRs #1282-1289, Apr 12)

**why**: two unrelated streams of work converged. (1) the homepage needed a way to toggle between the latest feed and the personalized for-you feed. (2) the browser observability proxy (`POST /logfire-proxy/v1/traces`) — shipped to forward browser OpenTelemetry data through the backend (Logfire requires server-side auth) — was saturating the FastAPI threadpool under production load, causing `/tracks/top` to take 10-29 seconds.

**what shipped**:
- **homepage feed switcher** (#1282-1286) — authenticated users with engagement history see a segmented control toggling between "latest tracks" and "for you". new `ForYouCache` state module mirrors `TracksCache` interface. feed mode persists to localStorage. tag filters hidden in for-you mode (backend handles hidden tags server-side). if the for-you probe returns empty (no engagement history), the toggle doesn't appear. several follow-up fixes: glass styling (#1284), tag persistence across feeds (#1285), feed mode persisting across hard refresh (#1286)
- **connection pool warmup** (#1287) — the existing pool warmup (#1025) only opened 1 connection at startup. with `pool_size=10`, the other 9 hit TCP+SSL setup on the first request burst after deploy, causing 1.5-5.5s connect spans. fix: warm all `pool_size` connections concurrently via `asyncio.gather`
- **browser observability toggle** (#1288) — added `BROWSER_OBSERVABILITY` env var (default: `true`) exposed via `GET /config`. frontend gates `initObservability()` on this flag. the proxy uses `run_in_threadpool` for synchronous HTTP forwarding — under load, 694+ proxy requests in 10 minutes (vs ~50 real API requests) starved async DB handlers
- **backend proxy guard** (#1289) — #1288's frontend-only toggle didn't stop stale cached clients (Cloudflare Pages) from continuing to hammer the proxy. 3,458 requests in 24 minutes post-deploy, averaging 1.9s each. fix: backend endpoint returns 204 immediately when `BROWSER_OBSERVABILITY=false`, regardless of client behavior. `/tracks/top` dropped from 10-18s to ~250ms

**root cause analysis**:
- `logfire.experimental.forwarding.logfire_proxy()` is synchronous — FastAPI wraps it in `run_in_threadpool`, consuming a thread per request. the default threadpool (40 threads) was overwhelmed by browser telemetry volume, blocking all async handlers waiting for threads
- the frontend-only toggle had a cache gap: Cloudflare Pages serves cached JS bundles, so clients that loaded the page before the deploy kept calling `initObservability()` unconditionally. the backend guard closes this regardless of client cache state

**decisions**:
- `BROWSER_OBSERVABILITY` defaults to `true` so new environments get telemetry without configuration. production sets it to `false` until a non-blocking proxy implementation exists (e.g. background queue, or Logfire adds native browser token support)
- the proxy endpoint is kept (not removed) — it's still the correct architecture when load is manageable. the fix is a gate, not a removal

---

#### CDN caching + backend decomposition (PRs #1275-1280, Apr 11)

**why**: a tech debt audit revealed two systemic issues: (1) R2 public buckets were served via `r2.dev` managed subdomains, which bypass Cloudflare's CDN cache layer entirely — every audio and image request went straight to R2 origin, and the 30% "cache hit ratio" in CF analytics was entirely from the frontend (Cloudflare Pages), not media assets. (2) the backend API had accumulated monolithic files (`lists.py` at 1149 lines, `albums.py` at 995 lines) with duplicated patterns and deferred imports scattered throughout.

**what shipped**:
- **CDN custom domains** (#1278) — provisioned `audio.plyr.fm` and `images.plyr.fm` as R2 custom domains via the Cloudflare API. enabled Smart Tiered Cache and a "Cache Everything" cache rule with 1-year edge TTL. set `Cache-Control: public, max-age=31536000, immutable` on all R2 uploads (objects are content-hashed, so this is safe). backfilled all 2,262 DB URLs from `r2.dev` → custom domains. staging equivalents (`audio-stg.plyr.fm`, `images-stg.plyr.fm`) provisioned in parallel. cache hit ratio climbed from 30% to 46% within 10 minutes of activation
- **`_s3_client()` consolidation** (#1278) — 9 identical 5-line S3 client connection blocks collapsed into one method. an S3/R2 swap is now a one-line change
- **API decomposition** (#1276) — `lists.py` (1149 lines) and `albums.py` (995 lines) split into subpackages following the existing `api/tracks/` pattern: `{router,schemas,cache,listing,mutations}.py`. ~15 deferred imports hoisted to top-level
- **PDS URL healing → jetstream** (#1276) — `ingest_handle_update` renamed to `ingest_identity_update`, now resolves DID to get current PDS URL on identity events (fires on both handle changes and PDS migrations). removed the lazy per-request PDS URL healing that was copy-pasted in 5 API endpoints
- **`fetch_list_item_uris` + `hydrate_tracks_from_uris`** (#1277) — extracted shared ATProto list record fetch and track hydration patterns. `fetch_list_item_uris(record_uri, pds_url) -> list[str]` replaces 5 copy-pasted fetch-then-extract blocks. `hydrate_tracks_from_uris(db, uris, session_did) -> list[TrackResponse]` collapses identical ~35-line hydration blocks duplicated between `get_playlist` and `get_playlist_by_uri`
- **scripts cleanup** (#1280) — removed 8 completed one-time migration scripts from Nov 2025 - Jan 2026 (-1,291 lines). added `migrate_cdn_urls.py` with dry-run, environment auto-detection

**decisions**:
- R2 custom domains were provisioned via the Cloudflare API MCP rather than the dashboard, but cache rules and tiered cache required dashboard configuration (the MCP OAuth scopes don't include zone-level rulesets)
- the `r2.dev` managed subdomains are left enabled — ATProto records on users' PDSs have `audioUrl` and `imageUrl` fields baked in with old `r2.dev` URLs that we can't retroactively update. those URLs continue to resolve, they just don't get CDN caching. the lexicon already documents `audioBlob` as canonical and `audioUrl` as CDN fallback
- HEAD requests to R2 custom domains always return `cf-cache-status: DYNAMIC` even when caching works correctly — only GET requests show real cache status. documented in `docs/internal/backend/configuration.md`

---

#### Leaflet mention service + embeds (PRs #1271-1273, Apr 10)

**why**: [Jared from Leaflet](https://awarm.leaflet.pub/3mj662txrs22p) shipped a mention services system that lets ATProto apps register as searchable, embeddable services in the Leaflet editor. plyr.fm is one of the first real implementations (alongside Wikipedia and Pokemon). a Leaflet user types `@`, selects plyr.fm, searches for a track or artist, and either mentions it inline or embeds a playable iframe — all without leaving the editor.

**what shipped**:
- **`GET /xrpc/parts.page.mention.search`** (#1271) — XRPC query endpoint per the `parts.page.mention.search` lexicon. wraps our existing pg_trgm fuzzy search across tracks, artists, albums, playlists, and tags. returns results with embed info (iframe `src` pointing to existing `/embed/*` pages), labels, descriptions, and subscope support for drilling into specific content types
- **`GET /.well-known/did.json`** (#1271) — DID document serving `did:web:api.plyr.fm` with a `#mention_search` service declaration. enables ATProto apps to proxy XRPC calls to plyr.fm without depending on a third-party feed service — the user's PDS resolves the DID and forwards the request directly
- **`/embed/u/[handle]`** (#1272) — new artist embed page showing recent tracks, reusing `CollectionEmbed` (same component as album/playlist embeds). all content types now have embeddable surfaces
- **`CollectionData` dedup** (#1272) — the interface was defined in 4 places; consolidated into `$lib/types.ts`
- **embed sizing** (#1273) — switched from `aspectRatio` (16:9 made collection embeds too tall) to fixed pixel dimensions: 600×160 for single tracks (compact player bar), 600×400 for collections (room for track list). these are defaults — Leaflet renders a draggable resize handle

**how it works in production**:
1. `parts.page.mention.service` record published to `plyr.fm`'s PDS repo, declaring `did:web:api.plyr.fm` as the service
2. `parts.page.mention.config/self` record enables the service for the `plyr.fm` account (per-user opt-in, like Bluesky feed generators)
3. Leaflet's appview indexes both records from the firehose
4. when a user searches: Leaflet → user's PDS → `did:web:api.plyr.fm` → our XRPC endpoint → results with embed URLs

**decisions**:
- plyr.fm serves its own XRPC endpoint via `did:web` — no dependency on Leaflet's feed service. any ATProto app implementing mention services can discover and use plyr.fm directly
- auth in embeds is deferred — Jared flagged the StorageAccess API as a possibility but it's unresolved across the ecosystem. our embeds are public-only for now
- the `parts.page.connect` MessageChannel RPC (host ↔ embed communication) is not implemented yet — would enable richer interactions like opening full track pages from within the embed

---

#### "atmosphere account" terminology (PRs #1268-1270, Apr 10)

**why**: [Sri's article](https://sri.leaflet.pub/3maltcnnbqs2n) makes the case for "atmosphere account" as the shared term for ATProto identities across apps. the login page previously said "internet handle" — time to align with the emerging ecosystem terminology. key insight: these are **accounts**, not handles. handles are something you get once you have an account.

**what shipped**:
- login page label: "internet handle" → "atmosphere account", link now points to [atproto.com/guides/glossary#handle](https://atproto.com/guides/glossary#handle)
- docs (listeners, artists): "enter your handle" → "enter your atmosphere account"
- glossary: split "handle (atproto handle)" into separate "atmosphere account" and "handle" definitions
- status-maintenance workflow: "ATProto identities" → "atmosphere accounts"
- README: "bluesky accounts" → "atmosphere accounts"
- updated login page screenshot to match

---

#### unlisted tracks (PR #1267, Apr 10)

**why**: artists need to publish tracks that are accessible by direct link or on their profile but don't appear in discovery feeds (latest, top, for-you). use case: drafts shared with collaborators, tracks that belong in an album context but shouldn't float independently in feeds.

**what shipped**:
- `unlisted` boolean on Track (default false)
- filtered from `GET /tracks/` (latest feed, when not scoped to artist), `GET /tracks/top`, and `GET /for-you/`
- **not** filtered from: artist profile, direct links, album/playlist context, search, portal, or `GET /tracks/?artist_did=...`

---

#### image moderation perf + analytics fix (PRs #1265-1266, Apr 10)

**why**: a real user session (annamist.com editing track 862) showed PATCH taking 8.9 seconds. Logfire traces revealed two bottlenecks: inline `await` on the moderation service (Claude Vision, ~6s) and R2 delete spraying every file extension (~1.3s of sequential HEAD requests).

**what shipped**:
- **image moderation → docket background task** (#1266) — the scan only flags and notifies, never gates the response. moved to async `scan_image_moderation` task, matching how copyright audio scans already work. ~6s saved
- **R2 delete → direct key lookup** (#1266) — parse extension from the image URL and hit the correct R2 key on first try instead of trying 12+ extensions. ~1.3s saved. combined: 8.9s → ~1s
- **analytics title clamping** (#1265) — long track titles overflowed "most played"/"most liked" cards on artist profiles. clamped to 2 lines with ellipsis

---

#### first-class album uploads with preserved track ordering (PRs #1260-1262, Apr 9)

**why**: album uploads via the album upload form lost the user's chosen track order after #1238 switched to concurrent uploads. the ATProto list record (the source of truth for album track order) was built by per-track sync tasks that sorted by `Track.created_at`, and `created_at` reflects the DB commit race under concurrency — not user intent. external review also caught two P1s: creating the album shell emitted an `album_release` CollectionEvent before any track succeeded (fake release in the activity feed), and appending tracks to an existing album truncated the list record to only the current session's tracks.

**what shipped**:
- **`POST /albums/`** (#1260) — first-class album creation endpoint. creates an empty album shell (title, description) without writing the ATProto list record. idempotent on `(artist_did, slug)` — matches the "type an existing album name to add tracks to it" UX. `album_release` CollectionEvent deferred to finalize so total upload failures don't publish a fake release
- **`POST /tracks/` with `album_id`** (#1260) — optional form field that skips `get_or_create_album`, links the track to the existing album at row creation, and skips per-track `schedule_album_list_sync`. mutually exclusive with the legacy `album: str` field
- **`POST /albums/{id}/finalize`** (#1260) — accepts `{track_ids: [int]}` in user-intended order. writes the ATProto list record **once** with strongRefs in the exact order requested. on append (when the album already has tracks from prior sessions), preserves existing tracks in their current list-record order and appends new tracks at the end. emits `album_release` on first successful finalize only (deduped)
- **SSE strongRef surface** (#1262) — the upload-progress SSE endpoint now surfaces `atproto_uri` and `atproto_cid` in the completion payload. caught by staging integration tests after #1260 merged — the SSE handler whitelisted only `track_id` and `warnings`, silently dropping the strongRef fields the upload pipeline wrote to `job.result`
- **dropped mid-page progress block** (#1261) — per-track toasts and per-card status pills from #1238 already provide richer feedback; the aggregate progress bar was a third view of the same data
- **empty album filtering** — `GET /albums/`, `GET /albums/{handle}`, search, and sitemap now filter to albums with at least one track, so abandoned draft shells never appear on artist profiles or in search results

**decisions**:
- no DB schema change — the ATProto list record remains the single source of truth for track order, consistent with how the album edit page's drag-and-drop reorder already works (`PUT /lists/{rkey}/reorder` writes the PDS directly). adding a `track_number` column would have forked the truth and required ongoing DB↔PDS synchronization
- the legacy `album: str` path (single-track `/upload` page) is untouched — its per-track sync is still racy in principle, but single-track uploads can't produce concurrent inserts by construction
- the `album_release` dedup is application-level (`SELECT` + `INSERT`), not DB-enforced (no partial unique index on `CollectionEvent`). concurrent finalize calls have a TOCTOU window — acceptable because the frontend calls finalize exactly once and the album edit page doesn't use finalize at all. flagged as a follow-up hardening opportunity
- internal docs: `docs/internal/backend/album-uploads.md` covers the full three-step flow, the atproto-native rationale, append semantics, and partial-failure behavior. plan doc at `docs/internal/plans/2026-04-09-album-upload-ordering.md`

---

#### unlisted /record page + reusable Waveform component (PRs #1251-1257, Apr 8-9)

**why**: uploading short audio (voice memos, field recordings, ideas) via the existing upload flow meant finding a desktop recorder, saving a file, then navigating to `/upload` and picking it — a disproportionate round-trip for a 30-second capture. inspired by Jared's Leaflet in-browser recorder: open the tab, press record, stop, preview, upload, done. separately, plyr.fm has needed a reusable waveform visualization for months — track detail, player, playlist rows all want one — so this PR ships the primitive alongside its first caller instead of duplicating the work later.

**what shipped**:
- **`/record` page** — unlisted (`noindex,nofollow`, not linked from nav), auth-gated. four-state machine: idle → recording → preview → uploading. `MediaRecorder` with a mime fallback chain (`audio/webm;codecs=opus` → `webm` → `mp4` for Safari → `ogg`). 10-minute hard cap with a 9:00 warning toast. default title `recording YYYY-MM-DD HH:MM`, default tag `voice-memo`. `autoTag: false` so the ML genre tagger doesn't clobber the voice-memo default. reuses the existing `$lib/uploader.svelte` singleton so progress/SSE/toast plumbing isn't duplicated; redirects to `/u/{handle}` so the user lands on their profile while the uploader toast tracks progress
- **backend audio format support** — `WEBM` and `OGG` added to the `AudioFormat` enum in `backend/_internal/audio.py`, both marked `is_web_playable = False` so they route through the existing transcoder. **zero Rust transcoder changes needed** — ffmpeg already decodes webm/opus/ogg natively. stored audio normalizes to mp3 for embeds and downstream tools
- **`$lib/components/Waveform.svelte`** — reusable inline-SVG waveform with dual-layer rendering (base bars + clipPath-masked progress overlay, wavesurfer-style single animatable rect instead of recoloring individual bars). mirrored/center-aligned bars, 2px minimum height so silent sections still show a hairline. accepts **either** pre-computed `peaks: number[]` **or** `source: Blob | string` (auto-decodes). click-to-seek + ArrowLeft/Right keyboard nudges, slider ARIA, per-instance random clipPath id so multiple waveforms on one page don't collide. themed via `--wf-base` and `--wf-progress` CSS custom props
- **`$lib/audio/peaks.ts`** — pure helper extracting normalized peaks from a `Blob` or `ArrayBuffer` via `AudioContext.decodeAudioData`. channels reduced by per-bucket **max** (not average) so stereo transients still show up. pure and cacheable — easy to memoize later when rendering waveforms for many tracks at once
- **follow-up polish** (#1252): aesthetics pass and link-preview metadata. #1255-1256 fix duration showing `Infinity/NaN` until first seek and ensure the duration upper bound is never 0 in the preview state. #1257 fixes a track-page `og:image` that could be left empty

**decisions**:
- waveform API designed for reuse from day one (accepts peaks OR source, optional `onSeek`, CSS-variable theming) — this is why the record page is its first caller, not an excuse to inline the rendering
- iframe embed, Claude-powered metadata autofill from audio content, file picker support for `.webm`/`.ogg` on `/upload`, and rendering waveforms across track detail / playlist / player surfaces are all deliberately deferred

---

#### unlisted /for-you personalized feed (PRs #1249-1250, Apr 8)

**why**: the homepage surfaces "latest" and "top tracks" but has nothing personalized — there was no "based on what you like, try this" surface. @spacecowboy17.bsky.social's collaborative-filtering For You algorithm in grain.social is well-tuned and documented; porting it gives us a working baseline without reinventing the scoring. ships unlisted (not linked from nav, `noindex,nofollow`) because the ranking is v1 and benefits from testing with intentional users before being promoted.

**what shipped**:
- new `GET /for-you/?cursor=<int>&limit=<int>` endpoint in `backend/src/backend/api/for_you.py`
- new `/for-you` route with infinite scroll, queue-all, and a cold-start "warming up" state for users with zero engagement history
- auth required; unauth visitors redirect to `/`

**scoring recipe** (from grain, unchanged):
```
score = sum(1 / total_edges(coengager) ** 1.0)  # picky co-engagers
      * paths ** 0.5                            # multi-path smoothing
      * 0.5 ** (age_hours / 48)                 # 48h half-life
      / popularity ** 0.3                       # dampen globally popular
```
co-engagers are filtered to those who engaged with the seed *before* we did (+24h grace window) — grain's key insight that rewards taste-makers over bandwagoners. cold start falls back to most-engaged tracks in the last 30 days.

**what's different from grain**:
- **engagement edges are likes OR playlist-adds.** grain only has favorites; we have a unified activity stream in `activity.py`, and `track_added_to_playlist` is a particularly strong curation signal ("this belongs next to these other tracks"). both edges get uniform weight 1.0 in v1
- **48h half-life instead of 6h** — audio ages slower than photo galleries; a two-week-old track is still meaningfully new
- **per-artist diversity cap (hard 2 per page)** — without this, one prolific archiver dominates the ranking, the same failure mode that killed the artist leaderboard in #1229
- **self-uploads excluded from seeds AND candidates** — your likes on your own tracks aren't a taste signal; your own uploads shouldn't be recommended back to you
- hidden-tag preferences are respected

**decisions**:
- pure collaborative filtering in v1; CLAP-embedding rerank deferred (obvious follow-up: take top ~200 grain-scored candidates, rerank by distance to centroid of user's seed embeddings — helps long-tail and cold-start)
- per-request score recomputation, no Redis cache — means pagination may drift slightly under heavy engagement churn, acceptable for v1
- differential edge weights (e.g. playlist-add = 2.0, comment = 1.5, like = 1.0) deferred until there's something to A/B against
- play signals as edges deferred — likes are sparse, plays are dense, needs its own experiment

---

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

CDN caching is live (#1275-1280) — audio and images served through `audio.plyr.fm` and `images.plyr.fm` custom domains with Cloudflare edge caching (1-year TTL, Smart Tiered Cache). cache hit ratio jumped from 30% to 46% within minutes. backend API decomposed: `lists.py` and `albums.py` split into subpackages, PDS URL healing moved from lazy per-request to proactive jetstream identity events, shared ATProto list helpers extracted. next: `config.py` decomposition (993 lines → split by concern), frontend state module grouping, portal/playlist page decomposition. Leaflet mention service (#1271-1273) and ooo.audio lexicon conversation (#705) continue. waveform rollout to other surfaces still pending as follow-up to #1251.

### known issues
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- harden file format support — revisit transcoding pipeline (FLAC graduated in #1189, AIFF still transcodes)
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable rules engine for moderation (#958)
- infrastructure consolidation — audit and migrate from Fly.io sprawl to Helm/K8s pattern (#907, reference: `../relay`)
- time-release gating (#642)
- social activity feed (#971)

## technical state

### architecture

**backend**
- language: Python 3.11+
- framework: FastAPI with uvicorn
- database: Neon PostgreSQL (serverless)
- storage: Cloudflare R2 (S3-compatible, CDN via custom domains)
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
- ✅ audio streaming via 307 redirects to CDN (audio.plyr.fm, edge-cached)
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

this is a living document. last updated 2026-04-13 (SDK namespace restructure, playlist support, cyclopts CLI migration).

