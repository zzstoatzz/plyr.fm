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

#### georgia as default font + deploy-docs misconfig (PR #1371, May 5)

**why**: informal poll favored georgia over the previous mono default. only changes the resolved default for users who never explicitly picked a font; explicit choices (including mono) are preserved by the `?? DEFAULT_FONT` fall-through, since `ui_settings.font_family` is absent from the JSONB until the user sets it.

**what shipped**:
- `DEFAULT_FONT: 'mono' → 'georgia'` (`preferences.svelte.ts`), `FONT_OPTIONS` reordered to lead with georgia
- body CSS fallback in `+layout.svelte` updated to Georgia stack (covers the moment before JS sets `--font-family`)
- docs site `--sl-font` switched to Georgia in `docs/site/src/styles/custom.css`. `--sl-font-system-mono` kept for code blocks
- accepted: one-frame mono → georgia flash on first post-deploy load for users with stale `localStorage['fontFamily'] === 'mono'` (cache was written from the resolved default, not raw `font_family`)

**incident surfaced during rollout**:
- merging the PR shipped Georgia to the **app** (staging, then prod via `just release-frontend-only`) but `docs.plyr.fm` kept serving mono
- diagnosis: `deploy-docs.yml` was succeeding to a Cloudflare Pages project on the **wrong account**. the `CLOUDFLARE_API_TOKEN` GitHub secret had been minted in the Prefect/work account (since 2026-03-06); the workflow was happily deploying into a black-hole project there while `docs.plyr.fm` is bound to the personal-account project (`plyr-fm-docs`, subdomain `plyr-fm-docs-9ac.pages.dev`)
- the personal-account project had not received a CI deploy since 2026-04-19 (commit `a4977bc2`, the last manual `wrangler` push). luckily only one PR (this one) actually changed `docs/site/**` in that window, so no backlog of stale docs — only the font change was missing
- fix: rotated `CLOUDFLARE_API_TOKEN` to a new token scoped to the personal account with Pages:Edit, updated `CLOUDFLARE_ACCOUNT_ID` to `3e9ba01cd687b3c4d29033908177072e`, re-ran the workflow. docs.plyr.fm now serves Georgia from a freshly-built bundle

**lesson**:
- a deploy that "succeeds" but never updates the user-facing surface is almost worse than a failure. consider: a sanity check at the end of `deploy-docs.yml` that GETs `https://docs.plyr.fm/_astro/<known-bundle>.css` (or the fresh hash from the build) and asserts the deploy actually moved the production alias

---

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

See `.status_history/2026-04.md` for detailed history.

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

georgia is the new default font (#1371) — explicit choices preserved via the existing `?? DEFAULT_FONT` fall-through. shipped to app + docs; rollout surfaced a pre-existing deploy-docs misconfig where CI had been silently deploying to the wrong Cloudflare account since 2026-03-06 (token rotated, fixed). image pipeline cleanup landed end-to-end (#1364-1366) — EXIF orientation, iPhone MPO normalization, two parallel upload paths consolidated. canonical DID storage for featured artists (#1362-1363) — closes the `displayName`/`display_name` drift class entirely via read-time profile resolution. infra: docket worker now on its own fly process group (#1359) so a runaway upload task can only OOM its own machine. audio revisions feature shipped (#1311-1320, #1325) — replace audio without losing track identity, with confirm-before-replace + restore + PDS blob re-upload on GC. like resurrection race fixed via Redis tombstone (#1338, closes #1321). upload reliability hardened across the stack (#1331, #1333, #1336, #1350) — migrated to docket, per-DID concurrency, shared-storage staging, pre-flight auth. issue triage 2026-05-05: closed #1321 (fixed) and #1328 (likely fixed, awaiting reporter); narrowed #1316 to audio_replace.py only. next: deploy-docs sanity check (assert prod alias moved), ship #1316 (createdAt fix in audio_replace), #1314/#1315 (audio replace race follow-ups), sheets unification (#1348), `config.py` decomposition.

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

this is a living document. last updated 2026-05-05 (georgia default font + deploy-docs incident, image pipeline cleanup, canonical DID storage, docket worker process split, audio revisions, upload reliability, issue triage).

