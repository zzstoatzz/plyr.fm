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

#### portal pagination + perf optimization (PRs #878-879, Feb 8)

**portal pagination (PR #878)**: `GET /tracks/me` now supports `limit`/`offset` pagination (default 10 per page). portal loads first 10 tracks with a "load more" button. export section uses total count for accurate messaging.

**GET /tracks/top latency fix (PR #879)**: baseline p95 was 1.2s due to stale connection reconnects and redundant DB queries.
- merged top-track-ids + like-counts into single `get_top_tracks_with_counts()` query (1 fewer round-trip)
- scoped liked-track check to `track_id IN (...)` (10 rows) instead of all user likes
- `pool_recycle` 7200s → 1800s to reduce stale connection spikes
- authenticated requests dropped from 11 DB queries to 7. post-deploy p95: ~550ms
- 14 new regression tests

---

#### repo reorganization (PR #876, Feb 8)

moved auxiliary services into `services/` (transcoder, moderation, clap) and infrastructure into `infrastructure/` (redis). updated all GitHub Actions workflows, pre-commit config, justfile module paths, and docs.

---

#### auto-tag at upload + ML audit (PRs #870-872, Feb 7)

**auto-tag on upload (PR #871)**: checkbox on the upload form ("auto-tag with recommended genres") that applies top genre tags after classification completes. ratio-to-top filter (>= 50% of top score, capped at 5), additive with manual tags. flag stored in `track.extra`, cleaned up after use.

**genre/subgenre split (PR #870)**: compound Discogs labels like "Electronic---Ambient" now produce two separate tags ("electronic", "ambient") instead of one compound tag.

**ML audit script (PR #872)**: `scripts/ml_audit.py` reports which tracks/artists have been processed by ML features. supports `--verbose` and `--check-embeddings` for privacy/ToS auditing.

---

#### ML genre classification + suggested tags (PRs #864-868, Feb 6-7)

**genre classification via Replicate**: tracks classified into genre labels using [effnet-discogs](https://replicate.com/mtg/effnet-discogs) on Replicate (EfficientNet trained on Discogs ~400 categories).

- on upload: classification runs as docket background task if `REPLICATE_ENABLED=true`
- on demand: `GET /tracks/{id}/recommended-tags` classifies on the fly if no cached predictions
- predictions stored in `track.extra["genre_predictions"]` with file_id-based cache invalidation
- raw Discogs labels cleaned to lowercase format. cost: ~$0.00019/run
- Replicate SDK incompatible with Python 3.14 (pydantic v1) — uses httpx directly with `Prefer: wait` header

**frontend UX (PR #868)**: suggested genre tags appear as clickable dashed-border chips in the portal edit modal. `$derived` reactively hides suggestions matching manually-typed tags.

---

#### mood search (PRs #848-858, Feb 5-6)

**search by how music sounds** — type "chill lo-fi beats" into the search bar and find tracks that match the vibe, not just the title.

**architecture**: CLAP (Contrastive Language-Audio Pretraining) model hosted on Modal generates audio embeddings at upload time and text embeddings at search time. vectors stored in turbopuffer. keyword and semantic searches fire in parallel — keyword results appear instantly (~50ms), semantic results append when ready (~1-2s).

**key design decisions**:
- unified search: no mode toggle. keyword + semantic results merge by score, client-side deduplication removes overlap
- graceful degradation: backend returns `available: false` instead of 502/503 when CLAP/turbopuffer are down
- quality controls: distance threshold, spread check to filter low-signal results, result cap
- gated behind `vibe-search` feature flag with version-aware terms re-acceptance

**hardening (PRs #849-858)**: m4a support for CLAP, correct R2 URLs, normalize similarity scores, switch from larger_clap_music to clap-htsat-unfused, handle empty turbopuffer namespace, rename "vibe search" → "mood search", concurrent backfill script.

---

#### recommended tags via audio similarity (PR #859, Feb 6)

`GET /tracks/{track_id}/recommended-tags` finds tracks with similar CLAP embeddings in turbopuffer, aggregates their tags weighted by similarity score. excludes existing tags, normalizes scores to 0-1. replaced by genre classification (PR #864) but the endpoint pattern persisted.

---

#### mobile login UX + misc fixes (PRs #841-845, Feb 2)

- **handle hint sizing (PRs #843-845)**: iterative fix for login page handle hint wrapping on mobile — final approach: reduced font size, gap, and `nowrap` to keep full text visible
- **PDS backfill gate (PR #842)**: PDS backfill button gated behind `pds-audio-uploads` feature flag
- **share button reuse (PR #841)**: track detail page now uses shared `ShareButton` component

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

ML-powered track features: genre classification (Replicate effnet-discogs) auto-runs on upload with optional auto-tagging. mood search (CLAP + turbopuffer) feature-flagged behind `vibe-search`, runs parallel to keyword search. performance optimization on hot paths (GET /tracks/top p95 cut from 1.2s to ~550ms). repo reorganized — services and infrastructure in dedicated directories.

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
- ✅ unified search with Cmd/Ctrl+K (keyword + mood search in parallel)
- ✅ mood search via CLAP embeddings + turbopuffer (feature-flagged)
- ✅ teal.fm scrobbling
- ✅ copyright moderation with ATProto labeler
- ✅ ML genre classification with suggested tags in edit modal + auto-tag at upload (Replicate effnet-discogs)
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
│   └── clap/             # ML embeddings (Python, Modal)
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

this is a living document. last updated 2026-02-08.

