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

### December 2025

#### tag filtering system and SDK tag support (Dec 2)

**tag filtering** (PRs #431-434):
- users can now hide tracks by tag via eye icon filter in discovery feed
- preferences centralized in root layout (fetched once, shared across app)
- `HiddenTagsFilter` component with expandable UI for managing hidden tags
- default hidden tags: `["ai"]` for new users
- tag detail pages at `/tag/[name]` with all tracks for that tag
- clickable tag badges on tracks navigate to tag pages

**navigation fix** (PR #435):
- fixed tag links interrupting audio playback
- root cause: `stopPropagation()` on links breaks SvelteKit's client-side router
- documented pattern in `docs/frontend/navigation.md` to prevent recurrence

**SDK tag support** (plyr-python-client v0.0.1-alpha.10):
- added `tags: set[str]` parameter to `upload()` in SDK
- added `-t/--tag` CLI option (can be used multiple times)
- updated MCP `upload_guide` prompt with tag examples
- status maintenance workflow now tags AI-generated podcasts with `ai` (#436)

**tags in detail pages** (PR #437):
- track detail endpoint (`/tracks/{id}`) now returns tags
- album detail endpoint (`/albums/{handle}/{slug}`) now returns tags for all tracks
- track detail page displays clickable tag badges

**bufo easter egg** (PR #438):
- tracks tagged with `bufo` trigger animated toad GIFs on the detail page
- uses track title as semantic search query against [find-bufo API](https://find-bufo.fly.dev/)
- toads are semantically matched to the song's vibe (e.g., "Happy Vibes" gets happy toads)
- results cached in localStorage (1 week TTL) to minimize API calls
- `TagEffects` wrapper component provides extensibility for future tag-based plugins
- respects `prefers-reduced-motion`; fails gracefully if API unavailable

---

#### queue touch reordering and header stats fix (Dec 2)

**queue mobile UX** (PR #428):
- added 6-dot drag handle to queue items for touch-friendly reordering
- implemented touch event handlers for mobile drag-and-drop
- track follows finger during drag with smooth translateY transform
- drop target highlights while dragging over other tracks

**header stats positioning** (PR #426):
- fixed platform stats not adjusting when queue sidebar opens/closes
- added `--queue-width` CSS custom property updated dynamically
- stats now shift left with smooth transition when queue opens

---

#### connection pool resilience for Neon cold starts (Dec 2)

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

**related**: this is a recurrence of the Nov 17 incident. that fix addressed the queue listener's asyncpg connection but not the SQLAlchemy pool connections.

---

#### now-playing API (PR #416, Dec 1)

**what shipped**:
- `GET /now-playing/{did}` and `GET /now-playing/by-handle/{handle}` endpoints
- returns track metadata, playback position, timestamp
- 204 when nothing playing, 200 with track data otherwise

**speculative integration with teal.fm**:
- opened draft PR to Piper (teal.fm's scrobbling service): https://github.com/teal-fm/piper/pull/27
- adds plyr.fm as a source alongside Spotify and Last.fm
- **status**: awaiting feedback from teal.fm team

---

#### admin UI improvements for moderation (PRs #408-414, Dec 1)

**what shipped**:
- dropdown menu for false positive reasons (fingerprint noise, original artist, fair use, other)
- artist/track links open in new tabs for verification
- AuDD score normalization (scores shown as 0-100 range)
- filter controls to show only high-confidence matches
- form submission fixes for htmx POST requests

---

#### ATProto labeler and copyright moderation (PRs #382-395, Nov 29-Dec 1)

**what shipped**:
- standalone labeler service integrated into moderation Rust service
- implements `com.atproto.label.queryLabels` and `subscribeLabels` XRPC endpoints
- k256 ECDSA signing for cryptographic label verification
- web interface at `/admin` for reviewing copyright flags
- htmx for server-rendered interactivity
- integrates with AuDD enterprise API for audio fingerprinting
- fire-and-forget background task on track upload
- review workflow with resolution tracking (violation, false_positive, original_artist)

**initial review results** (25 flagged tracks):
- 8 violations (actual copyright issues)
- 11 false positives (fingerprint noise)
- 6 original artists (people uploading their own distributed music)

**documentation**: see `docs/moderation/atproto-labeler.md`

---

#### developer tokens with independent OAuth grants (PR #367, Nov 28)

**what shipped**:
- each developer token gets its own OAuth authorization flow
- tokens have their own DPoP keypair, access/refresh tokens - completely separate from browser session
- cookie isolation: dev token exchange doesn't set browser cookie
- token management UI: portal → "your data" → "developer tokens"
- create with optional name and expiration (30/90/180/365 days or never)

**security properties**:
- tokens are full sessions with encrypted OAuth credentials (Fernet)
- each token refreshes independently
- revokable individually without affecting browser or other tokens

---

#### platform stats and media session integration (PRs #359-379, Nov 27-29)

**what shipped**:
- `GET /stats` returns total plays, tracks, and artists
- stats bar displays in homepage header (e.g., "1,691 plays • 55 tracks • 8 artists")
- Media Session API for CarPlay, lock screens, Bluetooth devices
- browser tab title shows "track - artist • plyr.fm" while playing
- timed comments with clickable timestamps
- constellation integration for network-wide like counts
- account deletion with explicit confirmation

---

#### export & upload reliability (PRs #337-344, Nov 24)

**what shipped**:
- database-backed jobs (moved tracking from in-memory to postgres)
- streaming exports (fixed OOM on large file exports)
- 90-minute WAV files now export successfully on 1GB VM
- upload progress bar fixes
- export filename now includes date

---

### October-November 2025

See `.status_history/2025-11.md` for detailed November development history including:
- async I/O performance fixes (PRs #149-151)
- transcoder API deployment (PR #156)
- upload streaming + progress UX (PR #182)
- liked tracks feature (PR #157)
- track detail pages (PR #164)
- mobile UI improvements (PRs #159-185)
- oEmbed endpoint for Leaflet.pub embeds (PRs #355-358)

## immediate priorities

### high priority features
1. **audio transcoding pipeline integration** (issue #153)
   - ✅ standalone transcoder service deployed at https://plyr-transcoder.fly.dev/
   - ⏳ next: integrate into plyr.fm upload pipeline
     - backend calls transcoder API for unsupported formats
     - queue-based job system for async processing
     - R2 integration (fetch original, store MP3)

### known issues
- playback auto-start on refresh (#225) - investigating localStorage/queue state persistence
- no ATProto records for albums yet (#221 - consciously deferred)
- no AIFF/AIF transcoding support (#153)

### new features
- issue #146: content-addressable storage (hash-based deduplication)
- issue #155: add track metadata (genres, tags, descriptions)
- issue #334: add 'share to bluesky' option for tracks
- issue #373: lyrics field and Genius-style annotations
- issue #393: moderation - represent confirmed takedown state in labeler

## technical state

### architecture

**backend**
- language: Python 3.11+
- framework: FastAPI with uvicorn
- database: Neon PostgreSQL (serverless)
- storage: Cloudflare R2 (S3-compatible)
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
- ✅ ATProto OAuth 2.1 authentication with encrypted state
- ✅ secure session management via HttpOnly cookies
- ✅ developer tokens with independent OAuth grants
- ✅ platform stats endpoint and homepage display
- ✅ Media Session API for CarPlay, lock screens, control center
- ✅ timed comments on tracks with clickable timestamps
- ✅ account deletion with explicit confirmation
- ✅ artist profiles synced with Bluesky
- ✅ track upload with streaming to prevent OOM
- ✅ track edit/deletion with cascade cleanup
- ✅ audio streaming via HTML5 player with 307 redirects to R2 CDN
- ✅ track metadata published as ATProto records
- ✅ play count tracking (30% or 30s threshold)
- ✅ like functionality with counts
- ✅ queue management (shuffle, auto-advance, reorder)
- ✅ mobile-optimized responsive UI
- ✅ cross-tab queue synchronization via BroadcastChannel
- ✅ share tracks via URL with Open Graph previews
- ✅ copyright moderation system with admin UI
- ✅ ATProto labeler for copyright violations

**albums**
- ✅ album database schema with track relationships
- ✅ album browsing and detail pages
- ✅ album cover art upload and display
- ✅ server-side rendering for SEO
- ⏸ ATProto records for albums (deferred, see issue #221)

**deployment (fully automated)**
- **production**:
  - frontend: https://plyr.fm
  - backend: https://relay-api.fly.dev → https://api.plyr.fm
  - database: neon postgresql
  - storage: cloudflare R2 (audio-prod and images-prod buckets)

- **staging**:
  - backend: https://api-stg.plyr.fm
  - frontend: https://stg.plyr.fm
  - database: neon postgresql (relay-staging)
  - storage: cloudflare R2 (audio-stg bucket)

### technical decisions

**why Python/FastAPI instead of Rust?**
- rapid prototyping velocity during MVP phase
- rich ecosystem for web APIs
- excellent async support with asyncio
- trade-off: accepting higher latency for faster development

**why Cloudflare R2 instead of S3?**
- zero egress fees (critical for audio streaming)
- S3-compatible API (easy migration if needed)
- integrated CDN for fast delivery

**why forked atproto SDK?**
- upstream SDK lacked OAuth 2.1 support
- needed custom record management patterns
- maintains compatibility with ATProto spec

**why async everywhere?**
- event loop performance: single-threaded async handles high concurrency
- I/O-bound workload: most time spent waiting on network/disk
- PRs #149-151 eliminated all blocking operations

## cost structure

current monthly costs: ~$35-40/month

- fly.io backend (production): ~$5/month
- fly.io backend (staging): ~$5/month
- fly.io transcoder: ~$0-5/month (auto-scales to zero)
- neon postgres: $5/month
- audd audio fingerprinting: ~$10/month
- cloudflare pages: $0 (free tier)
- cloudflare R2: ~$0.16/month
- logfire: $0 (free tier)
- domain: $12/year (~$1/month)

## deployment URLs

- **production frontend**: https://plyr.fm
- **production backend**: https://api.plyr.fm
- **staging backend**: https://api-stg.plyr.fm
- **staging frontend**: https://stg.plyr.fm
- **repository**: https://github.com/zzstoatzz/plyr.fm (private)
- **monitoring**: https://logfire-us.pydantic.dev/zzstoatzz/relay
- **bluesky**: https://bsky.app/profile/plyr.fm

## admin tooling

### content moderation
script: `scripts/delete_track.py`
- requires `ADMIN_*` prefixed environment variables
- deletes audio file, cover image, database record
- notes ATProto records for manual cleanup

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
4. merge to main → deploys to staging automatically
5. verify on staging
6. create github release → deploys to production automatically

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
└── justfile              # task runner
```

## documentation

- [deployment overview](docs/deployment/overview.md)
- [configuration guide](docs/configuration.md)
- [queue design](docs/queue-design.md)
- [logfire querying](docs/logfire-querying.md)
- [moderation & labeler](docs/moderation/atproto-labeler.md)

---

this is a living document. last updated 2025-12-02.
