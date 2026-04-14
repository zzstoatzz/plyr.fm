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

#### feed toggle cleanup (PR #1296, Apr 14)

**why**: the segmented pill control for latest/for-you feeds (#1282-1286) looked busy and visually inconsistent with the rest of the homepage. it was the only element using a two-button pill pattern — everything else (top tracks period, clickable headings) uses inline cycling buttons.

**what shipped**:
- replaced the pill with an inline cycling button matching the top tracks period toggle — tap to cycle between "latest" and "for you"
- -50 lines of pill CSS/markup, consistent visual language across the page

---

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

See `.status_history/2026-04.md` for April 1-9 entries (album uploads, /record, /for-you, tag filtering, WebSocket hardening, AT-URI routes, health checks, browser observability incident).

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

SDK namespace restructure shipped for plyr-python-client v0.0.1a16 — flat methods → namespace objects (`client.tracks.list()`, `client.playlists.create()`), playlist CRUD (9 methods), cyclopts CLI, proper `TrackRef` identifier types. CDN caching live (#1275-1280) — `audio.plyr.fm` and `images.plyr.fm` custom domains with 1-year edge TTL. feed switcher on homepage refined (#1296) — replaced segmented pill with inline cycle toggle matching period toggle pattern. browser telemetry proxy incident resolved (#1288-1289) — synchronous Logfire proxy was saturating the threadpool, backend kill switch added. avatar restore on account reactivation (#1291). next: `config.py` decomposition, frontend state module grouping, waveform rollout to other surfaces, ooo.audio lexicon conversation (#705).

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

this is a living document. last updated 2026-04-14 (feed toggle cleanup).

