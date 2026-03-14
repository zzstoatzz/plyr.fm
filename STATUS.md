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

### March 2026

#### [community feedback](https://bsky.app/profile/cinny.bun.how/post/3mgq2bao26s2p) (Mar 10)

three pieces of feedback on Bluesky:

> this application doesnt subscribe to an atproto event stream at all. lol okay

> it has "backfill" but it uses that word to mean "writing track records to the PDS" ???

> idk why plyr feature-flags flac upload behind transcoding to mp3 when flac playback is supported in literally every browser that isnt IE11

[public response](https://bsky.app/profile/zzstoatzz.io): all the feedback is welcome — PDS blob size limits motivated the initial R2-first design, the "backfill" terminology is confusing, and lossless uploads are feature-flagged because the transcoder sidecar was still in development.

what we did about each:

- **event stream**: shipped Jetstream subscription (see below). the reason it wasn't trivial is that firehose records need to hit the same treatment as API uploads — moderation, origin trust validation, dedup against the race between the API write and the firehose echo. this required refactoring the ingest paths so Jetstream events enter through the same codepaths as the API. there's an interesting design tension here: an external service could watch the firehose for `fm.plyr.*` records and POST them to the API as unauthenticated tips ("this record exists on this PDS"), which would eliminate the separate ingest path entirely. we opted against that for now but it's the kind of architectural question that made this non-trivial. addressed across PRs #1068-1084.
- **"backfill" terminology**: checked all public-facing surfaces. the portal UI says "migrate audio to your PDS" and "copy N audio blobs to your PDS" — the word "backfill" only appears in internal code (`PdsBackfillControl.svelte` variable names, `/pds-backfill/` API path) and internal docs, never in user-visible text. no action needed.
- **lossless uploads**: consciously deferred ([#1065](https://github.com/zzstoatzz/plyr.fm/issues/1065)). FLAC is web-playable in every modern browser, so the feature flag isn't a technical limitation — it's a product decision about how to roll out file format support. hardening format support across the board is on the roadmap.

---

#### Jetstream real-time ingestion (PRs #1068-1076, Mar 10-12)

motivated by the event stream feedback above. plyr.fm was push-only — it wrote records to your PDS but never listened. if someone creates a track record using another ATProto client, plyr.fm had no idea it existed. that's not how the protocol is supposed to work — the whole point of putting data on the PDS is that any client can interact with it and the network stays in sync.

**what shipped:** a Jetstream WebSocket consumer that subscribes to the ATProto firehose, filtered to `fm.plyr.*` collections. when a record event arrives for a known artist DID, it's dispatched to one of 12 ingest tasks (track/like/comment/list CRUD + profile updates). incoming records are validated against lexicon JSON schemas before touching the database. the consumer runs as a single-instance perpetual docket task with cursor persistence in Redis for replay on reconnect.

the interesting design problem was the race between the upload API and Jetstream. when a user uploads through plyr.fm, the API writes a record to the PDS, and Jetstream sees that same write ~2 seconds later. without coordination, you'd get duplicate tracks. the solution: the upload path reserves a DB row with `publish_state=pending` before writing to the PDS, so when Jetstream's event arrives, it finds the pending row and promotes it to `published` with the CID from the PDS response. idempotent — the track exists exactly once regardless of which path commits first.

PDS-backed audio playback (PR #1071) also landed in this batch — tracks stored on the user's PDS now redirect to `com.atproto.sync.getBlob` instead of 404'ing.

**staging smoketest:** enabled on staging and tested three ways — CI integration tests (all 12 pass), SDK uploads via `plyrfm`, and the real test: writing records directly to the PDS with `pdsx` to exercise the "track created outside the API" path end-to-end. full lifecycle verified: invalid record (no audio) → rejected by ingest guard, blob-only track → ingested as `audio_storage="pds"`, external audioUrl → ingested as `audio_storage="r2"`, delete + Jetstream replay → blocked by tombstone.

**ghost track fix (PRs #1079-1080):** Jetstream rewinds its cursor by 5 seconds on reconnect for at-least-once delivery. when a track is created and deleted within that window, the replayed delete no-ops (row already gone) and the replayed create re-creates the track as a ghost — no PDS record, no audio, unfixable via UI. 29+ orphan test tracks were polluting the staging feed from integration test runs.

fix: Redis tombstone with 5-minute TTL, following the existing teal scrobble dedup pattern. `_write_tombstone(uri)` fires on every track delete (both API and ingest paths — including when `rowcount == 0`, the exact replay scenario). `_check_tombstone(uri)` runs in `ingest_track_create` before creating from scratch (after the existing-row check, so the pending→published finalization path is unaffected). fail-open on Redis errors — ghost tracks are the current behavior anyway, so degraded Redis doesn't make things worse.

tradeoff: suppresses any create for the same URI within the TTL window, not just stale replays. acceptable because plyr.fm always generates fresh TID-based rkeys for new tracks — a legitimate same-URI re-create never happens in practice.

also fixed: `track.features` could be `None` from the DB, crashing `TrackResponse` serialization with `ValidationError`. ingest now defaults to `[]`, and the response schema coerces `None` → `[]`.

**gotchas:**
- when the API and Jetstream both try to delete the same track simultaneously, Postgres deadlocks on the FK cascade to `track_tags`. harmless (docket retries and the track gets deleted) but noisy. wrapped the delete handlers to swallow the deadlock since the API transaction handles it.
- the `lexicons/` directory was never copied into the Docker image, so record validation was silently passing everything in staging/production. caught it by creating a record with no audio reference — it got indexed as a valid track. one-line Dockerfile fix.

**open questions before production:**
- **audit trail**: ingest events are only in Logfire — no persistent record of what came through the firehose. an audit log surfaced in the activity feed would give visibility into PDS-direct activity, but the volume could grow fast.

**status**: Jetstream soak on staging complete — ghost track fix deployed and verified via Logfire ("skipping create for tombstoned URI" confirmed blocking replayed creates). ready for production.

#### Jetstream hardening for production (PRs #1083-1084, Mar 12-13)

two security/correctness fixes before production rollout:

**environment-scoped collection filter (PR #1083):** the Jetstream consumer was subscribing to all `fm.plyr.*` collections regardless of environment. staging (`fm.plyr.stg.track`) and production (`fm.plyr.track`) share the same firehose — without scoping, staging would ingest production records and vice versa. fixed by deriving the collection filter from `settings.atproto` namespace settings so each environment only sees its own records.

**audioUrl/imageUrl origin trust validation (PR #1084):** the ingest pipeline blindly stored any `audioUrl` from incoming ATProto records as `r2_url` in the database. the `/audio/{file_id}` endpoint then does `RedirectResponse(url=r2_url)` — so a YouTube link, a tracking pixel, or any arbitrary URL would be accepted and served as if it were a track. same gap for `imageUrl`.

fix: `is_trusted_audio_origin` and `is_trusted_image_origin` check the URL origin against the platform's R2 CDN domain before accepting. the async signature and `artist_did` parameter are forward-compatible with a future "bring your own storage" feature where artists register trusted external origins. validation logic at ingest:
- trusted origin → accept normally
- untrusted `audioUrl` + `audioBlob` present → strip URL, use blob-only (`audio_storage="pds"`)
- untrusted `audioUrl` + no blob → reject the track
- untrusted `imageUrl` → strip (track without art is still valid)

14 regression tests covering all trust/strip/reject scenarios.

**status**: both fixes deployed to production. Jetstream is live.

#### API layer dedup (PR #1086, Mar 13)

housekeeping refactor across the API layer: extracted shared image upload helper (`_internal/image_uploads.py`), replaced manual cookie/header extraction with `Depends(get_optional_session)`, and removed redundant OAuth token-refresh retry loops (already handled by `make_pds_request`). playlist covers now get moderation scanning (previously missing). net -303 lines.

---

#### track descriptions + RSS feeds (PR #1045, Mar 6)

new `description` field on tracks — free-text, persisted in the ATProto record and the database. displayed on track detail pages. also added per-artist RSS feed generation (`/feeds/{handle}/rss`) with enclosures pointing to audio URLs, so any podcast client can subscribe to an artist's uploads.

#### public docs restructure (PRs #1031-1041, Mar 6)

rewrote docs.plyr.fm from developer-only internal docs to an audience-first site serving four groups: listeners, artists, developers, and contributors. moved internal operational docs to `docs-internal/`. created audience pages, rewrote contributing guide, overhauled landing page with live trending track embeds and animated hero waveform. created an agentskills.io contribute skill for AI coding assistants. CORS regex widened to allow all `*.plyr.fm` subdomains (PR #1034) — docs.plyr.fm stats and search were previously blocked.

#### infrastructure fixes (PRs #1044, #1060, Mar 6)

**rate limiting to Redis (PR #1044)**: rate limits were per-Fly-Machine (in-memory), so 2 machines = 2x the configured limit. switched to Redis-backed global counters via docket. falls back to in-memory for local dev.

**PDS default for uploads (PR #1060)**: new uploads now default to storing audio on the user's PDS instead of R2. one-line change — flips the default so user data ownership is opt-out rather than opt-in.

#### embed glow bar + share button (PRs #996-998, Mar 1)

**glow bar**: 1px accent-colored bar (`#6a9fff`) on track and collection embeds that lights up on playback and dims on pause, matching the main Player's `::before` style. uses `color-mix()` for the box-shadow glow. works across all container query breakpoints.

**share button**: inline link icon next to the logo that copies the plyr.fm page URL (not the embed URL) to clipboard with "copied!" tooltip feedback. falls back to `navigator.share()` when clipboard API is unavailable. no auth dependency. hidden in MICRO mode, white-themed in blurred-bg modes (NARROW, SQUARE/TALL).

**embed layout fixes** (PRs #996-997): fixed track embed clipping at short heights, guarded collection WIDE query, and fixed track embed layout for tall/portrait containers.

---

### February 2026

See `.status_history/2026-02.md` for detailed history.

---

### January 2026

See `.status_history/2026-01.md` for detailed history.

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

Jetstream deployed to production with environment-scoped collection filtering and origin trust validation for ingest URLs. both API uploads and Jetstream ingest share a unified `run_post_track_create_hooks()` path for copyright scanning, genre classification, and embedding generation. remaining open question: audit trail persistence for firehose events.

### known issues
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- harden file format support — graduate lossless uploads (#1065), revisit transcoding pipeline
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable rules engine for moderation (Osprey rules engine PR #958 open)
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

- fly.io (backend + redis + moderation): ~$14/month
- neon postgres: $5/month
- cloudflare (R2 + pages + domain): ~$1/month
- audd audio fingerprinting: $5-10/month (usage-based)
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

see the [contributing guide](https://docs.plyr.fm/contributing/) for setup instructions, or install the [contribute skill](skills/contribute/SKILL.md) for AI coding assistants.

## documentation

- **public docs**: [docs.plyr.fm](https://docs.plyr.fm) — for listeners, artists, developers, and contributors
- **internal docs**: [docs-internal/](docs-internal/) — deployment, auth internals, runbooks, moderation
- **lexicons**: [docs.plyr.fm/lexicons/overview](https://docs.plyr.fm/lexicons/overview/) — ATProto record schemas

---

this is a living document. last updated 2026-03-13 (status maintenance: archived February, added missing March entries).

