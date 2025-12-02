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

### connection pool resilience for Neon cold starts (Dec 2)

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
- disabled scale to zero on production compute (`suspend_timeout_seconds: -1`) to eliminate cold starts entirely

**related**: this is a recurrence of the Nov 17 incident. that fix addressed the queue listener's asyncpg connection but not the SQLAlchemy pool connections.

**documentation**: updated `docs/backend/database/connection-pooling.md` with Neon serverless considerations and incident history.

---

### now-playing API (PR #416, Dec 1)

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

### admin UI improvements for moderation (PRs #408-414, Dec 1)

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

### ATProto labeler and copyright moderation (Nov 29-30)

**what shipped**:
- standalone Rust moderation service with ATProto labeler (plyr-moderation.fly.dev)
- integrates AuDD enterprise API for audio fingerprinting
- implements `com.atproto.label.queryLabels` and `subscribeLabels` XRPC endpoints
- k256 ECDSA signing for cryptographic label verification
- admin UI at `/admin` for reviewing flagged tracks (htmx + server rendering)
- labels emitted when copyright violations detected, negation labels for false positives
- initial review of 25 flagged tracks: 8 violations, 11 false positives, 6 original artists

**documentation**: see `docs/moderation/atproto-labeler.md` and `.status_history/2025-11.md` for full details

---

### developer tokens with independent OAuth grants (PR #367, Nov 28)

**what shipped**:
- each developer token gets its own OAuth authorization flow
- tokens have their own DPoP keypair, access/refresh tokens - completely separate from browser session
- token management UI in portal: create with optional name and expiration, revoke individual tokens
- prevents logout from deleting dev tokens (critical bug fixed during implementation)

**security properties**:
- tokens are full sessions with encrypted OAuth credentials (Fernet)
- each token refreshes independently (no staleness from browser session refresh)
- revokable individually without affecting browser or other tokens
- explicit OAuth consent required at PDS for each token created

---

### platform stats and media session integration (Nov 27-29)

**what shipped**:
- platform stats endpoint: `GET /stats` returns total plays, tracks, and artists
- stats bar in homepage header (e.g., "1,691 plays • 55 tracks • 8 artists")
- Media Session API: provides track metadata to CarPlay, lock screens, Bluetooth devices, macOS control center
- browser tab title shows "track - artist • plyr.fm" while playing
- timed comments with clickable timestamps for seeking
- constellation integration for network-wide like counts
- account deletion with explicit confirmation

---

### oEmbed endpoint and export reliability (Nov 24-25)

**what shipped**:
- oEmbed endpoint for proper embed display in Leaflet.pub (via iframely)
- database-backed jobs for upload/export tracking (persists across server restarts)
- streaming exports to prevent OOM on large files (90-minute WAV files now export successfully)
- upload progress bar fixed (was treating bytes as percentage)

---

### performance optimizations (Nov 10-12)

**async I/O fixes**:
- converted R2 operations to async (portal load: 2+ seconds → ~200ms)
- parallelized ATProto PDS lookups (homepage load: 2-6 seconds → 200-400ms)
- async storage writes/deletes with chunked I/O (constant memory usage)

**queue and token hardening**:
- persistent `image_url` on Track rows (queue hydration no longer probes R2)
- per-session locks in token refresh (fixes race conditions causing 401s)
- backfilled missing image URLs (eliminated 600ms latency gap)

---

### core features shipped (Oct-Nov)

- ✅ ATProto OAuth 2.1 authentication with encrypted state
- ✅ track upload with streaming (prevents OOM on large files)
- ✅ track edit and deletion with cascade cleanup
- ✅ audio streaming via HTML5 player with 307 redirects to R2 CDN
- ✅ track metadata published as ATProto records (fm.plyr.track namespace)
- ✅ play count tracking (30% or 30s threshold)
- ✅ like functionality with network-wide counts (constellation integration)
- ✅ artist analytics dashboard
- ✅ queue management (shuffle, auto-advance, reorder)
- ✅ cover art upload and display
- ✅ mobile-optimized responsive UI
- ✅ cross-tab queue synchronization via BroadcastChannel
- ✅ Open Graph previews for track sharing
- ✅ dedicated track detail pages
- ✅ album database schema with browsing/detail pages
- ✅ standalone audio transcoding service (Rust/Axum with ffmpeg)
- ✅ admin content moderation script (`scripts/delete_track.py`)
- ✅ copyright moderation with ATProto labeler

**see `.status_history/2025-11.md` for detailed November development history**

---

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

### performance optimizations
2. **persist concrete file extensions in database**: currently brute-force probing all supported formats on read
   - already know `Track.file_type` and image format during upload
   - eliminating repeated `exists()` checks reduces filesystem/R2 HEAD spam
   - improves audio streaming latency (`/audio/{file_id}` endpoint walks extensions sequentially)

3. **stream large uploads directly to storage**: current implementation reads entire file into memory before background task
   - multi-GB uploads risk OOM
   - stream from `UploadFile.file` → storage backend for constant memory usage

### new features
4. **content-addressable storage** (issue #146)
   - hash-based file storage for automatic deduplication
   - reduces storage costs when multiple artists upload same file
   - enables content verification

---

## open issues by timeline

### immediate
- issue #153: audio transcoding pipeline (ffmpeg worker for AIFF/FLAC→MP3)
- issue #225: playback auto-start on refresh (investigating localStorage/queue state persistence)

### short-term
- issue #146: content-addressable storage (hash-based deduplication)
- issue #24: implement play count abuse prevention
- file extension persistence in database

### medium-term
- issue #208: security - medium priority hardening tasks
- issue #207: security - add comprehensive input validation
- issue #56: design public developer API and versioning
  - **note**: SDK (`plyrfm`) and MCP server (`plyrfm-mcp`) now available at https://github.com/zzstoatzz/plyr-python-client
  - `plyrfm` on PyPI - Python SDK + CLI for plyr.fm API
  - `plyrfm-mcp` on PyPI - MCP server, hosted at https://plyrfm.fastmcp.app/mcp
  - issue still open for formal API versioning and public documentation
- issue #155: add track metadata (genres, tags, descriptions)
- issue #166: content moderation for user-uploaded images
- issue #167: DMCA safe harbor compliance
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

---

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

---

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

---

### technical decisions

**why Python/FastAPI instead of Rust?**
- rapid prototyping velocity during MVP phase
- rich ecosystem for web APIs (fastapi, sqlalchemy, pydantic)
- excellent async support with asyncio
- lower barrier to contribution
- trade-off: accepting higher latency for faster development
- future: can migrate hot paths to Rust if needed (transcoding service already deployed)

**why Fly.io instead of AWS/GCP?**
- simple deployment model (dockerfile → production)
- automatic SSL/TLS certificates
- built-in global load balancing
- reasonable pricing for MVP ($5/month)
- easy migration path to larger providers later

**why Cloudflare R2 instead of S3?**
- zero egress fees (critical for audio streaming)
- S3-compatible API (easy migration if needed)
- integrated CDN for fast delivery
- significantly cheaper than S3 for bandwidth-heavy workloads

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

**why async everywhere?**
- event loop performance: single-threaded async handles high concurrency
- I/O-bound workload: most time spent waiting on network/disk
- recent work (PRs #149-151) eliminated all blocking operations
- trade-off: debugging async code harder than sync, but worth throughput gains

---

## cost structure

current monthly costs: ~$5-6

- cloudflare pages: $0 (free tier)
- cloudflare R2: ~$0.16 (storage + operations, no egress fees)
- fly.io production: $5.00 (2x shared-cpu-1x VMs with auto-stop)
- fly.io staging: $0 (auto-stop, only runs during testing)
- neon: $0 (free tier, 0.5 CPU, 512MB RAM, 3GB storage)
- logfire: $0 (free tier)
- domain: $12/year (~$1/month)

---

## deployment URLs

- **production frontend**: https://plyr.fm
- **production backend**: https://relay-api.fly.dev (redirects to https://api.plyr.fm)
- **staging backend**: https://api-stg.plyr.fm
- **staging frontend**: https://stg.plyr.fm
- **repository**: https://github.com/zzstoatzz/plyr.fm (private)
- **monitoring**: https://logfire-us.pydantic.dev/zzstoatzz/relay
- **bluesky**: https://bsky.app/profile/plyr.fm
- **latest release**: 2025.1129.214811

---

## health indicators

**production status**: ✅ healthy
- uptime: consistently available (one 5-minute outage Dec 2, resolved)
- response times: <500ms p95 for API endpoints
- error rate: <1% (mostly invalid OAuth states)
- storage: ~55 tracks uploaded, functioning correctly

**key metrics**
- total tracks: ~55
- total artists: ~8
- total plays: ~1,691
- storage used: <1GB R2
- database size: <10MB postgres

---

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

---

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

---

## documentation

- [deployment overview](docs/deployment/overview.md)
- [configuration guide](docs/configuration.md)
- [queue design](docs/queue-design.md)
- [logfire querying](docs/logfire-querying.md)
- [pdsx guide](docs/pdsx-guide.md)
- [neon mcp guide](docs/neon-mcp-guide.md)

---

this is a living document. last updated 2025-12-02.
