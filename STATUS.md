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

### February 2026

#### optimize GET /tracks/top latency (PR #879, Feb 8)

**baseline (production, 171 requests over 3 days)**: p50=123ms, p95=1204ms, p99=1576ms. the p95/p99 spikes were caused by stale connection reconnects during `pool_pre_ping` and redundant DB round-trips.

**optimizations**:
- **merged query**: new `get_top_tracks_with_counts()` returns (track_id, like_count) tuples in a single GROUP BY — the count was already computed to sort, now it's returned instead of discarded. eliminates a redundant `get_like_counts` call (1 fewer DB round-trip)
- **scoped liked query**: the authenticated user's liked-track check now filters by `track_id IN (...)` (10 rows) instead of scanning all user likes
- **pool_recycle 7200s → 1800s**: connections recycle every 30min instead of 2h, reducing stale connections that trigger expensive reconnects

**verified via Logfire traces**: authenticated requests dropped from 11 DB queries to 7. post-deploy requests at 517-600ms vs baseline p95 of 1.2s.

**14 new regression tests** covering ordering, limit clamping, auth state, like counts, comment counts, and tags.

---

#### auto-tag at upload + ML audit script (PRs #871-872, Feb 7)

**auto-tag on upload (PR #871)**: checkbox on the upload form ("auto-tag with recommended genres") that automatically applies genre tags after classification completes. user doesn't need to come back to the portal to apply suggested tags.

- frontend: `autoTag` state + checkbox below TagInput, threaded through `uploader.svelte.ts` into FormData
- backend: `auto_tag` form param stored in `track.extra["auto_tag"]`, consumed by `classify_genres` background task
- after classification, applies top tags using ratio-to-top filter (>= 50% of top score, capped at 5)
- additive with manual tags — user can add their own AND get auto-tags
- flag cleaned up from `track.extra` after use (no schema migration needed)

**ML audit script (PR #872)**: `scripts/ml_audit.py` reports which tracks and artists have been processed by ML features (genre classification, CLAP embeddings, auto-tagging). for privacy policy and terms-of-service auditing. supports `--verbose` for track-level detail, `--check-embeddings` for turbopuffer vector counts.

---

#### ML genre classification + suggested tags (PRs #864-868, Feb 6-7)

**genre classification via Replicate**: tracks are now automatically classified into genre labels using the [effnet-discogs](https://replicate.com/mtg/effnet-discogs) model on Replicate (EfficientNet trained on Discogs ~400 categories).

**how it works**:
- on upload: if `REPLICATE_ENABLED=true`, classification runs as a docket background task
- on demand: `GET /tracks/{id}/recommended-tags` classifies on the fly if no cached predictions
- predictions stored in `track.extra["genre_predictions"]` with `genre_predictions_file_id` for cache invalidation when audio is replaced
- raw Discogs labels (`Electronic---Ambient`) cleaned to `ambient electronic` format
- cost: ~$0.00019/run (~$0.11 per 575 tracks, CPU inference)

**frontend UX (PR #868)**: when editing a track on the portal, suggested genre tags appear as clickable dashed-border chips below the tag input. wave loading animation while fetching. clicking a chip adds the tag. `$derived` reactively hides suggestions matching manually-typed tags. all failures silently hide the section.

**implementation details**:
- Replicate Python SDK incompatible with Python 3.14 (pydantic v1) — uses httpx directly against the Replicate HTTP API with `Prefer: wait` header
- `ReplicateSettings` in config, `ReplicateClient` singleton follows `clap_client.py` pattern
- backfill script: `scripts/backfill_genres.py` with concurrency control
- privacy policy updated to list Replicate, terms bumped for re-acceptance
- docs: `docs/backend/genre-classification.md`

**PRs**:
- #864: core implementation (replicate client, background task, endpoint, backfill script, tests)
- #865: clean Discogs genre names, add documentation
- #866: link genre-classification from docs index
- #867: cache invalidation keyed by file_id
- #868: suggested tags UI in portal edit modal

---

#### mood search MVP + semantic search hardening (PRs #848-858, Feb 5-6)

**mood search shipped** (PR #848): users can search by vibe/mood using natural language queries like "chill beats for studying". built on CLAP audio embeddings stored in turbopuffer, with a feature flag (`vibe-search`) and version-aware terms re-acceptance (privacy policy updated for ML processing).

**how it works**:
- text query → CLAP text embedding → turbopuffer cosine similarity → ranked tracks
- results merged with keyword search in parallel, deduplicated by score
- feature-flagged behind `vibe-search` user flag + terms version check

**CLAP pipeline fixes (PRs #849-850)**: m4a support added (was failing on non-wav), R2 URL corrected, Modal API updated. embedding pipeline now normalizes similarity scores properly.

**search quality hardening (PRs #851-858)**:
- unified search runs keyword + semantic in parallel, merges by score instead of separating by type (#851, #858)
- distance threshold + result cap to filter low-signal semantic matches (#852)
- spread check filters results where all scores are similarly mediocre (#853)
- switched CLAP model from `larger_clap_music` to `clap-htsat-unfused` (better quality, smaller) (#854)
- handle empty turbopuffer namespace without error (#855)
- concurrent backfill script, renamed "vibe search" → "mood search" throughout (#856)
- cold start latency fix for search endpoint (#857)

---

#### paginate portal tracks list (PR #878, Feb 8)

portal tracks list now loads 25 tracks initially with a "load more" button instead of fetching all tracks at once. reduces initial page load for artists with large catalogs.

---

#### repo reorganization (PR #876, Feb 8)

moved `transcoder/`, `moderation/`, `redis/`, and `clap/` into `services/` and `infrastructure/` directories to match the documented project structure. updated all justfiles, Dockerfiles, GitHub Actions workflows, and deployment configs.

---

#### smaller fixes (Feb 2-8)

- **mobile login handle hint** (PRs #843-845): prevent text wrap, hide hint text on mobile (show only service links), adaptively size based on viewport
- **shared ShareButton** (PR #841): track detail page now uses the same ShareButton component as everywhere else instead of a one-off implementation
- **PDS backfill feature flag** (PR #842): gate PDS backfill behind `pds-audio-uploads` feature flag (was previously accessible to all users)
- **split genre/subgenre tags** (PR #870): genre predictions like "Electronic---Ambient" now produce two separate tags (`electronic`, `ambient`) instead of one combined tag
- **remove duplicate toggle** (PR #874): duplicate auto-download toggle removed from playback settings section
- **recommended tags endpoint** (PR #859, #861-862): `GET /tracks/{id}/recommended-tags` with turbopuffer vector fetch fix and namespace naming docs

---

### January 2026

See `.status_history/2026-01.md` for detailed history including:
- per-track PDS migration + UX polish (PRs #835-839, Jan 30-31)
- PDS blob storage for audio (PRs #823-833, Jan 29)
- PDS-based account creation (PRs #813-815, Jan 27)
- lossless audio support (PRs #794-801, Jan 25)
- auth check optimization (PRs #781-782, Jan 23)
- remove SSR sensitive-images fetch (PR #785, Jan 24)
- listen receipts (PR #773, Jan 22)
- responsive embed v2 (PRs #771-772, Jan 20-21)
- terms of service and privacy policy (PRs #567, #761-770, Jan 19-20)
- content gating research, logout modal UX (Jan 16-18)
- avatar refresh and tooltip polish (PRs #750-752, Jan 13)
- copyright flagging fix (PR #748, Jan 12)
- Neon cold start fix (Jan 11)
- multi-account experience (PRs #707-714, Jan 3-5)
- integration tests, track edit UX, auth stabilization (Jan 6-9)
- artist bio links, copyright moderation, OAuth permission sets (Jan 1-3)

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

ML-powered track features shipped: genre classification (Replicate effnet-discogs) auto-runs on upload with optional auto-tagging. mood search (CLAP embeddings + turbopuffer) feature-flagged behind `vibe-search` with unified keyword+semantic results. performance optimization pass on hot endpoints (GET /tracks/top p95 cut in half). portal pagination for large catalogs. repo reorganization to match documented project structure.

### known issues
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable rules engine for moderation
- time-release gating (#642)

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
- ✅ unified search with Cmd/Ctrl+K (keyword + mood/semantic in parallel)
- ✅ teal.fm scrobbling
- ✅ copyright moderation with ATProto labeler
- ✅ ML genre classification with suggested tags in edit modal + auto-tag at upload (Replicate effnet-discogs)
- ✅ mood search via CLAP audio embeddings + turbopuffer (feature-flagged)
- ✅ docket background tasks (copyright scan, export, atproto sync, scrobble, genre classification)
- ✅ media export with concurrent downloads
- ✅ supporter-gated content via atprotofans
- ✅ listen receipts (tracked share links with visitor/listener stats)

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

current monthly costs: ~$20/month (plyr.fm specific)

see live dashboard: [plyr.fm/costs](https://plyr.fm/costs)

- fly.io (backend + redis + moderation): ~$14/month
- neon postgres: $5/month
- cloudflare (R2 + pages + domain): ~$1/month
- audd audio fingerprinting: $5-10/month (usage-based)
- replicate (genre classification): <$1/month (scales to zero, ~$0.00019/run)
- modal (CLAP embeddings): usage-based (scales to zero)
- turbopuffer (vector search): usage-based
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
├── services/
│   ├── transcoder/       # Rust audio transcoding (Fly.io)
│   ├── moderation/       # Rust content moderation (Fly.io)
│   └── clap/             # ML audio embeddings (Python, Modal)
├── infrastructure/
│   └── redis/            # self-hosted Redis (Fly.io)
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

this is a living document. last updated 2026-02-08 (status maintenance: archived January 2026 to `.status_history/2026-01.md`).
