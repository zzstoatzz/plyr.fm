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

### May 2026

#### image pipeline cleanup (PRs #1364-1366, May 3)

**why**: phone JPEGs typically store the sensor in landscape with an EXIF `Orientation` tag asking viewers to rotate at display time. browsers honor it; PIL doesn't. cropped/resized WebP thumbnails came out sideways for any track whose source had a non-identity tag. surfaced as @incognitothief / @zzstoatzz.io's "day and age" cover rendering rotated everywhere except the detail page (which read the unrotated `image_url`).

**what shipped**:
- **EXIF orientation** (#1364) — `ImageOps.exif_transpose` on upload + thumbnail generation. backfill script (`scripts/backfill_image_orientation.py`) reprocessed historical assets
- **two upload paths consolidated** (#1365) — `_internal/image_uploads.process_image_upload` (used by edit paths: tracks PATCH, albums, playlists) and `api/tracks/uploads.stage_image_to_storage` (used by the upload pipeline) were two parallel functions doing the same job with subtly different behavior. #1364's `normalize_orientation` only landed in the first one. consolidated, same anti-pattern as #1363's resolver dup
- **iPhone MPO normalization + backfill fix** (#1366) — iPhone JPEGs are recognized by Pillow as `MPO` (Multi-Picture Object), not `JPEG`. the `_PIL_SAVE_FORMAT` mapping in #1364 was missing `'mpo'`, so `save_format` came back None and `normalize_orientation` silently skipped 13 of 20 affected prod images. also unwrapped storage proxy in the backfill script

**decisions**:
- backfill is opt-in via script rather than a one-time migration — tracks are content-hashed so re-upload would change keys and break `audioUrl` references in PDS records
- followed up with two new issues filed today (#1367 auto-purge CF cache when R2 image overwritten, #1368 data integrity for orphan `image_id` refs) — kept as backlog rather than rolled into this cluster

---

#### canonical DID storage with read-time profile resolution (PRs #1362-1363, May 3)

**why**: closes #1355. 3 prod tracks (918, 938, 88) rendered "feat." with no name because `track.features` rows had `displayName` (camelCase) but the frontend reads `display_name` (snake_case). root cause was deeper than case: identity metadata (handle, displayName, avatar) was denormalized into both the PDS record AND the DB row, so it drifted on every profile change.

**what shipped**:
- **lexicon relaxed** — `featuredArtist.required` from `["did","handle"]` → `["did"]`, marked handle/displayName deprecated. consumers should resolve from DID
- **profile resolver** — new `_internal.atproto.profiles.resolve_dids()`: JOIN artists table → in-process LRU → bsky `getProfile` fallback. `TrackResponse.features` becomes typed `list[FeaturedArtist]`, populated by resolver, never returns raw JSONB
- **resolver consolidation** (#1363) — found two parallel features-from-handles resolvers drifted apart in error semantics: `resolve_featured_artists` in `_internal/atproto/handles.py` (lenient, used by upload) vs `resolve_feature_handles` in `api/tracks/metadata_service.py` (strict, used by edit). consolidated into one with a configurable `strict` flag, killed ~80 lines of duplication

**decisions**:
- read-time resolution over write-time normalization — chose to take the resolver hit on every API read rather than rewrite all historical track records. profile changes propagate instantly without backfill
- LRU + DB-first means most lookups never hit bsky getProfile, so the read-time cost is negligible after warmup
- full design rationale in `docs/internal/plans/featured-artist-references.md`

---

#### docket worker on its own fly process group (#1359, May 1)

**why**: 2026-04-30 incident — one user's album upload OOM'd uvicorn and produced 502s + silent logouts. before this PR, `relay-api` ran uvicorn AND a docket Worker in the same process; any background-task OOM took the HTTP server with it. structural fix from #1357.

**what shipped**:
- two fly process groups: **`app`** runs just uvicorn (opens a Docket *client*, no Worker, sized for HTTP fan-out only); **`worker`** runs just the Docket Worker via dedicated `backend.worker` entrypoint (no HTTP, sized at 2GB for the in-memory upload pipeline)
- `_internal/background.py` split into `docket_client_lifespan()` and `docket_worker_lifespan()`. `main.py` switches to client lifespan (one-line change). new `backend/worker.py` mirrors observability setup
- `fly.toml` declares both process groups, machines auto-distribute

**decisions**:
- a runaway upload task can now only OOM its own machine; HTTP stays up. the cost is one extra always-on worker machine — worth it for clean isolation

---

### April 2026

#### upload reliability hardening (PRs #1331, #1333, #1334, #1336, #1350, Apr 24-27)

**why**: 2026-04-24 — `flo.by` uploaded 6 tracks in a single album fan-out. six concurrent uploads held six of the 10 connection-pool slots for over a minute and starved every other request (`/auth/me` p95 hit 9.7s, `/health` 3s). dug in and found a stack of latent bugs.

**what shipped**:
- **upload + audio replace migrated to docket** (#1331) — `POST /tracks/` and `PUT /tracks/{id}/audio` were on `fastapi.BackgroundTasks.add_task`, which runs the task inside the ASGI request lifecycle **after** the response is sent. consequence: any request-scoped DB session stayed checked out of the pool until the task finished (20–100s per upload). pattern dated to the first streaming-uploads commit (Nov 2025); docket landed in Dec but upload orchestration was never migrated. integration test covering 10 concurrent uploads locks the scenario in
- **stage to shared storage** (#1336) — #1331 mechanically forwarded request-handler `/tmp/...` paths over Redis. on prod fly.io with multiple machines per process group, docket workers frequently land on a different machine than the request handler — different `/tmp`, silent `FileNotFoundError`. fix: HTTP handler streams upload to a request-local temp file (constant-memory size enforcement only), then stages bytes to shared R2 staging keys before enqueueing the docket task. evidence from prod: 7 jobs split 4 fail / 3 succeed by pure machine-routing luck before this fix
- **PDS 401 retry resilience** (#1332) — always refresh on 401 + widen transient-error retry net. eliminates upload failures from short-lived OAuth refresh windows
- **per-DID concurrency cap + exponential backoff** (#1333) — bound concurrent PDS calls per user, with backoff, so one user's burst can't saturate ATProto-side rate limits and cascade
- **session-state race on concurrent album creation** (#1334) — fixed
- **pre-flight auth check before destructive upload step** (#1350) — an expired session during upload was producing a misleading "lost connection to server" error from the SSE pipeline AFTER the user had filled out the entire form, attached files, and attested rights. now: ping `/auth/me` first; on `expired`, stash form metadata to sessionStorage + redirect to `/login` with return URL (audio file can't be serialized — prompt user to reattach on return); on `unverified`, surface a "couldn't verify your session" toast without proceeding

**decisions**:
- preflight uses a new `preflightAuth` helper rather than `auth.refresh()` because refresh treats network errors as session-invalid
- ATProto sync is intentionally NOT rolled into preflight — it's a separate failure mode that surfaces well in the existing error path

---

#### audio revisions: replace audio on existing track (PRs #1311-1320, #1325, Apr 19-22)

**why**: Logfire spans showed `darkhart.bsky.social` deleting + re-uploading the same track 3× in ~65 minutes (885 → 886 → 887 → 888). each cycle wasted an R2 upload, a PDS blob upload, an ATProto `createRecord` + `deleteRecord`, and silently nuked any likes / playlist refs / comments / play counts. needed a way to swap the audio file backing an existing track without losing track identity.

**what shipped**:
- **`PUT /tracks/{id}/audio`** (#1311) — atomic swap of `file_id`, `file_type`, `r2_url`, `pds_blob_*`, `audio_storage`, `atproto_record_cid`, `extra.duration`. track id, URI, likes, comments, plays, playlist refs all preserved. PDS audio blob re-uploaded (best-effort; falls back to r2-only on size limit). ATProto record PUT to existing rkey. stale `genre_predictions` cleared
- **frontend replace flow** (#1312, #1313) — replace audio from track edit form with useful current-audio context label
- **confirm-before-replace + revisions** (#1318) — Alex reported that hitting "cancel" after picking a file did not roll back the replace. added confirmation gate. every replace also snapshots displaced audio into a `track_revisions` row in the same DB transaction. owner-only `GET /tracks/{id}/revisions` lists history; `POST /tracks/{id}/revisions/{revision_id}/restore` does an instant pointer-swap back. retention cap: 10 per track
- **restore preserves PDS blob ref** (#1319) — restore writes the original blob CID back to the track row
- **graceful fallback when PDS GC'd the blob** (#1320, #1325) — PDSes GC unreferenced blobs after a short grace period. before #1320: `BlobNotFound` aborted restore with 502, leaving user stuck. fix in #1320: retry publishing without `audioBlob`, downgrade `audio_storage="r2"`. then #1325: that fix silently broke plyr.fm's core promise that users own their audio on their PDS — restore now re-uploads R2 bytes to the user's PDS to mint a fresh blob CID instead of publishing a record with no `audioBlob`

**decisions**:
- restore is an instant pointer swap, not a re-upload — existing R2 / PDS blobs reused when present
- restore republishes the PDS record (non-negotiable) so the user's PDS stays in sync with the DB
- schema is provider-neutral: `audio_url` not `r2_url`, no `r2_key` (parseable from URL). PDS-specific columns stay (PDS isn't a provider, it's the protocol)
- followed up with three known-issue tickets (#1314 orphan R2 on concurrent replace, #1315 in-flight scan stale results, #1316 `createdAt` bumped on PDS) — backlog, not blocking

---

#### like resurrection race (PRs #1322, #1338, Apr 21-25)

**why**: `test_cross_user_like` flaked intermittently in the staging integration suite (failed 2026-04-20, 2026-04-25). investigation confirmed real race, not flakiness:

```
1. user clicks LIKE → DB row R (atproto_like_uri=NULL), schedule pds_create_like
2. user clicks UNLIKE before task runs → DELETE R (no PDS-delete, no URI yet)
3. pds_create_like runs: PDS create returns URI X; SELECT R → gone → orphan-cleanup branch schedules delete_record_by_uri(X)
4. Jetstream emits like-create for X BEFORE delete event propagates
5. ingest_like_create finds no existing row → INSERTS fresh row with URI X. unlike just got undone
6. eventually delete event arrives, ingest_like_delete clears the row — but in the gap, user sees their unlike reverted
```

**what shipped**:
- **revert "flakiness" retry-poll** (#1322) — the test had been patched with a retry-poll under the assumption of flakiness; reverted to expose the actual bug (per house rule: retry-polls hide real bugs)
- **Redis tombstone on cancelled URIs** (#1338) — at step (3c), tombstone the URI in Redis keyed `like_cancelled:<uri>` with 5-minute TTL. `ingest_like_create` checks the tombstone and drops the create event. closes #1321

**decisions**:
- tombstone over schema column: a `cancelled_at` column would be more "complete" but requires Alembic migration on prod, broader query changes, and TTL covers jetstream propagation just as well
- comments likely have the same race shape (`pds_create_comment`) — not yet patched

---

#### copyright self-match suppression (#1341, Apr 26)

**why**: `flo.by` uploaded his catalog. AuDD identified each track's dominant match as **Floby IV** (his stage name elsewhere). every scan returned `is_flagged=true`, which (a) showed a red "potential copyright violation" badge to the artist on his own `/portal` page, and (b) fired an admin DM per scan — admin received ~30 DMs in one session. `sync_copyright_resolutions` flipped `is_flagged=false` within 5 min, but only after the artist had already seen the flag and DMs had landed.

**what shipped**:
- in `_store_scan_result`, when AuDD returns matches whose artist matches the uploader's own profile/handle, demote the match to `is_flagged=false` before the row is written. flag never reaches UI or DM

**decisions**:
- handled at write-time (not after-the-fact via sync) so the badge and DM both stay quiet from the start
- a separate unfixed bug in `sync_copyright_resolutions` silently flips `is_flagged=false` for URIs that were never labelled — tracked in project memory, not addressed here

---

#### player + sheets polish (PRs #1339, #1340, #1342, Apr 25-26)

**Android lock-screen autoplay (#1339)** — closes the upstream issue. on Android with screen locked, album/playlist playback stopped at the end of each track. root cause: chain from `<audio onended>` to next `audio.play()` had ~5 microtask boundaries plus an `await getAudioSource(...)`. on a foregrounded tab, fine. on Android with screen locked, Chrome treats the page as non-audible the moment the previous track ends — by the time `audio.play()` finally runs the policy already changed. fix: synchronous fast path for auto-advance.

**embed MediaSession (#1340)** — empirical iOS lock-screen finding: embed surfaces set NOTHING on `navigator.mediaSession`. lock-screen controls showed generic placeholders — no title, no cover art, next/previous greyed or stale-handlered. main app `Player.svelte` had correct setup; embeds never got it. new `lib/media-session.ts` helper wraps the four MediaSession APIs with no-op fallbacks; embeds wired up.

**likers sheet swipe-to-dismiss (#1342)** — the handle on the likers sheet was decorative — visually a near-universal "drag-me-down to close" affordance, with no event handlers. only working dismiss paths were a small × and backdrop tap. new `swipeToDismiss` Svelte 5 attachment in `frontend/src/lib/swipe-to-dismiss.svelte.ts` — first step toward broader unification (#1348 tracks the rest).

---

#### album cover inheritance + album route fix (#1337, #1349, Apr 25-26)

- **album cover inheritance** (#1337) — `TrackInfo.svelte` already fell back to `track.album?.image_url` when per-track image was unset. detail page, list items, grid cards, and embed surface did NOT — they rendered placeholders. the same track showed artwork in the player and a blank everywhere else. fixed as render-time fallback (the album HAS the art; the track INHERITS unless it sets its own) rather than DB backfill — backfill would be wrong if the album cover later changes
- **album upload toast 404** (#1349) — toast linked to `/album/${slug}`, but the actual route is `/u/[handle]/album/[slug]`. tapping the action 404'd right after a successful publish

---

#### search mode split + global font selector (PRs #1300, #1310, Apr 15-18)

- **search mode split** (#1310) — the Cmd+K modal had been through three iterations: vibe search MVP shipped with a toggle (#848), removed the toggle in favor of parallel fire + "sounds like" separator (#851), then merged both lists by score (#858). step 3 hurt: BM25 relevance and cosine similarity are both 0–1 but measure different things — sorting a mixed list by joint score produced jarring interleaves where mediocre semantic matches outranked solid keyword hits. since only the `vibe-search` flag holders saw it, blast radius was small, but it had to be nailed before any broader rollout. now: explicit mode chips, default keyword, flagged users get a chip toggle for mood
- **global font selector** (#1300) — six options in settings + profile menu (mono default, geist, inter, system, georgia, comic sans). each button previews in its own font. stored in `ui_settings` JSONB, cached in localStorage to prevent flash. applied via `--font-family` CSS custom property

---

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

image pipeline cleanup landed end-to-end (#1364-1366) — EXIF orientation, iPhone MPO normalization, two parallel upload paths consolidated. canonical DID storage for featured artists (#1362-1363) — closes the `displayName`/`display_name` drift class entirely via read-time profile resolution. infra: docket worker now on its own fly process group (#1359) so a runaway upload task can only OOM its own machine. audio revisions feature shipped (#1311-1320, #1325) — replace audio without losing track identity, with confirm-before-replace + restore + PDS blob re-upload on GC. like resurrection race fixed via Redis tombstone (#1338, closes #1321). upload reliability hardened across the stack (#1331, #1333, #1336, #1350) — migrated to docket, per-DID concurrency, shared-storage staging, pre-flight auth. issue triage 2026-05-05: closed #1321 (fixed) and #1328 (likely fixed, awaiting reporter); narrowed #1316 to audio_replace.py only. next: ship #1316 (createdAt fix in audio_replace), #1314/#1315 (audio replace race follow-ups), audio replace metric backfill, sheets unification (#1348), `config.py` decomposition.

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

this is a living document. last updated 2026-05-05 (image pipeline cleanup, canonical DID storage, docket worker process split, audio revisions, upload reliability, issue triage).

