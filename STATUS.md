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

#### mobile login UX polish (PRs #843-845, Feb 2)

**handle hint text fixes**: the login page's hint text ("your @handle from Bluesky or Blacksky") was wrapping awkwardly on mobile. multiple iterations to fix it:
- PR #843: hide "your " prefix on narrow screens
- PR #844: hide entire text, show only service links
- PR #845: final approach — smaller font, tighter gap, nowrap to keep it all visible

#### PDS backfill gating (PR #842, Feb 2)

**backfill endpoint now respects feature flag**: `POST /pds-backfill/audio` was accessible to any authenticated user. now returns 403 without the `pds-audio-uploads` flag. frontend `PdsBackfillControl` only renders when user has the flag.

#### shared ShareButton (PR #841, Feb 2)

**track detail page consolidation**: replaced custom inline share button (93 lines of dead code) with the shared `ShareButton` component used everywhere else.

### January 2026

See `.status_history/2026-01.md` for detailed history including:
- per-track PDS migration + UX polish (PRs #835-839, Jan 30-31)
- PDS blob storage for audio (PRs #823-833, Jan 29)
- PDS-based account creation (PRs #813-815, Jan 27)
- user reports + feedback modal (PRs #805-812, Jan 27)
- lossless audio support (PRs #794-801, Jan 25)
- auth check optimization (PRs #781-782, Jan 23)
- SSR fetch removal (PR #785, Jan 24)
- listen receipts (PR #773, Jan 22)
- responsive embed v2 (PRs #771-772, Jan 20-21)
- terms of service and privacy policy (PRs #761-770, Jan 19-20)
- logout modal UX (PRs #755-757, Jan 17-18)
- idempotent teal scrobbles (PR #754, Jan 16)
- avatar refresh and tooltip polish (PRs #750-752, Jan 13)
- copyright flagging fix (PR #748, Jan 12)
- Neon cold start fix (Jan 11)
- multi-account experience (PRs #707, #710, #712-714, Jan 3-5)
- integration test harness (PR #744, Jan 9)
- track edit UX improvements (PRs #741-742, Jan 9)
- auth stabilization (PRs #734-736, Jan 6-7)
- timestamp deep links (PRs #739-740, Jan 8)
- and more...

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

PDS blob storage shipped and feature-flagged. uploads store audio on user's PDS when the `pds-audio-uploads` flag is enabled and the user opts in via settings. per-track migration modal lets users selectively backfill existing tracks to PDS with file size visibility and non-blocking toast-based progress. R2 CDN remains primary delivery path.

**end-of-year sprint [#625](https://github.com/zzstoatzz/plyr.fm/issues/625) shipped:**
- moderation consolidation: sensitive images moved to moderation service (#644)
- moderation batch review UI with Claude vision integration (#672, #687-690)
- atprotofans: supporter badges (#627) and content gating (#637)

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
- ✅ unified search with Cmd/Ctrl+K
- ✅ teal.fm scrobbling
- ✅ copyright moderation with ATProto labeler
- ✅ docket background tasks (copyright scan, export, atproto sync, scrobble)
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
├── redis/                # self-hosted Redis config
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

this is a living document. last updated 2026-02-03.
