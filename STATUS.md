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

#### atprotofans supporter badges (PR #627, Dec 22)

**phase 1 of paywall integration**:
- supporter badges now appear on artist pages when a logged-in viewer supports the artist via atprotofans
- new `SupporterBadge.svelte` component with heart icon styling
- calls atprotofans `validateSupporter` API directly from frontend (public endpoint)
- badge only shows when: viewer is authenticated, artist has atprotofans enabled, and viewer isn't viewing their own profile

**bug fix** (PR #635): use artist DID as signer (not broker DID) for direct atprotofans contributions

---

#### rate limit moderation endpoint (PR #629, Dec 21)

**incident response**: detected suspicious activity - 72 requests in 17 seconds from a single IP targeting `/moderation/sensitive-images`. investigation via Logfire showed:
- single IP with no User-Agent header
- requests spaced ~230ms apart (too consistent for human activity)

**fix**: added `10/minute` rate limit using existing slowapi infrastructure.

---

#### end-of-year sprint (Dec 20-31)

**focus**: two foundational systems for 2026.

**track 1: moderation architecture overhaul**
- consolidate sensitive images into moderation service
- add event-sourced audit trail
- implement configurable rules (replace hard-coded thresholds)

**track 2: atprotofans paywall integration**
- phase 1: read-only supporter validation (show badges) ✅
- phase 2: platform registration (artists create support tiers)
- phase 3: content gating (track-level access control)

**tracking**: issue #625

---

#### beartype + moderation cleanup (PRs #617-619, Dec 19)

**runtime type checking** (PR #619):
- enabled beartype runtime type validation across the backend
- test infrastructure: session-scoped TestClient fixture (5x faster tests)

**moderation cleanup** (PRs #617-618):
- consolidated moderation code, addressing issues #541-543
- `sync_copyright_resolutions` now runs automatically via docket Perpetual task

**follow-up** (PR #634): fixed float literals for progress_pct to satisfy beartype

---

#### UX polish (PRs #604-607, #613, #615, #624, Dec 17-20)

**login improvements** (PRs #604, #613):
- login page uses "internet handle" terminology with collapsible FAQ
- input normalization: strips `@` and `at://` prefixes automatically

**artist page fixes** (PR #615):
- track pagination now works correctly for artists with many tracks
- fixed mobile album card overflow

**Svelte 5.25+ patterns** (PR #624):
- adopted overridable `$derived` pattern for optimistic UI
- added `aria-label` for accessibility on icon-only buttons

**login redirect** (PRs #631-633):
- attempted `/library` redirect post-login
- reverted to `/portal` - library page auth check was breaking OAuth exchange

---

#### offline mode foundation (PRs #610-611, Dec 17)

**experimental offline playback**:
- storage layer using Cache API for audio bytes + IndexedDB for metadata
- `GET /audio/{file_id}/url` endpoint returns direct R2 URLs for client-side caching
- "auto-download liked" toggle in experimental settings section
- works offline once tracks are downloaded

---

### Earlier December 2025

See `.status_history/2025-12.md` for detailed history including:
- visual customization: custom backgrounds, glass effects (PRs #595-596, Dec 16)
- performance: removed moderation call from track listing (PRs #590-591, Dec 14-15)
- confidential OAuth client with 180-day tokens (PRs #578-582, Dec 12-13)
- mobile UI polish & background task expansion (PRs #558-572, Dec 10-12)
- pagination & album management (PRs #550-554, Dec 9-10)
- docket background tasks (PRs #534-546, Dec 9)
- artist support links & inline playlist editing (PRs #520-532, Dec 8)
- playlist fast-follow fixes (PRs #507-519, Dec 7-8)
- playlists, ATProto sync, library hub (PR #499, Dec 6-7)
- sensitive image moderation (PRs #471-488, Dec 5-6)
- teal.fm scrobbling (PR #467, Dec 4)

### November 2025

See `.status_history/2025-11.md` for:
- unified search with Cmd+K (PR #447)
- light/dark theme system (PR #441)
- tag filtering and bufo easter egg (PRs #431-438)
- developer tokens (PR #367)
- copyright moderation system (PRs #382-395)
- export & upload reliability (PRs #337-344)
- transcoder API deployment (PR #156)

## immediate priorities

### end-of-year sprint (Dec 20-31)

see [sprint tracking issue #625](https://github.com/zzstoatzz/plyr.fm/issues/625) for details.

| track | focus | status |
|-------|-------|--------|
| moderation | consolidate architecture, add rules engine | planning |
| atprotofans | supporter validation, content gating | planning |

### known issues
- playback auto-start on refresh (#225)
- iOS PWA audio may hang on first play after backgrounding

### backlog
- audio transcoding pipeline integration (#153) - transcoder service deployed, integration deferred
- share to bluesky (#334)
- lyrics and annotations (#373)

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
- ✅ secure session management via HttpOnly cookies
- ✅ developer tokens with independent OAuth grants
- ✅ platform stats and Media Session API
- ✅ timed comments with clickable timestamps
- ✅ artist profiles synced with Bluesky
- ✅ track upload with streaming
- ✅ audio streaming via 307 redirects to R2 CDN
- ✅ play count tracking, likes, queue management
- ✅ unified search with Cmd/Ctrl+K
- ✅ teal.fm scrobbling
- ✅ copyright moderation with ATProto labeler
- ✅ docket background tasks (copyright scan, export, atproto sync, scrobble)
- ✅ media export with concurrent downloads

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

current monthly costs: ~$18/month (plyr.fm specific)

see live dashboard: [plyr.fm/costs](https://plyr.fm/costs)

- fly.io (plyr apps only): ~$12/month
  - relay-api (prod): $5.80
  - relay-api-staging: $5.60
  - plyr-moderation: $0.24
  - plyr-transcoder: $0.02
- neon postgres: $5/month
- cloudflare (R2 + pages + domain): ~$1.16/month
- audd audio fingerprinting: $0-10/month (6000 free/month)
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
├── moderation/           # Rust moderation service (ATProto labeler)
├── transcoder/           # Rust audio transcoding service
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

this is a living document. last updated 2025-12-23.
