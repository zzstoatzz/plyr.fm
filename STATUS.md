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

#### playlist fast-follow fixes (PRs #507-519, Dec 7-8)

**public playlist viewing** (PR #519):
- playlists now publicly viewable without authentication
- ATProto records are public by design - auth was unnecessary for read access
- shared playlist URLs no longer redirect unauthenticated users to homepage

**inline playlist creation** (PR #510):
- clicking "create new playlist" from AddToMenu previously navigated to `/library?create=playlist`
- this caused SvelteKit to reinitialize the layout, destroying the audio element and stopping playback
- fix: added inline create form that creates playlist and adds track in one action without navigation

**UI polish** (PRs #507-509, #515):
- include `image_url` in playlist SSR data for og:image link previews
- invalidate layout data after token exchange - fixes stale auth state after login
- fixed stopPropagation blocking "create new playlist" link clicks
- detail page button layouts: all buttons visible on mobile, centered AddToMenu on track detail
- AddToMenu smart positioning: menu opens upward when near viewport bottom

**documentation** (PR #514):
- added lexicons overview documentation at `docs/lexicons/overview.md`
- covers `fm.plyr.track`, `fm.plyr.like`, `fm.plyr.comment`, `fm.plyr.list`, `fm.plyr.actor.profile`

---

#### playlists, ATProto sync, and library hub (PR #499, Dec 6-7)

**playlists** (full CRUD):
- create, rename, delete playlists with cover art upload
- add/remove/reorder tracks with drag-and-drop
- playlist detail page with edit modal
- "add to playlist" menu on tracks with inline create
- playlist sharing with OpenGraph link previews

**ATProto integration**:
- `fm.plyr.list` lexicon for syncing playlists/albums to user PDSes
- `fm.plyr.actor.profile` lexicon for artist profiles
- automatic sync of albums, liked tracks, profile on login

**library hub** (`/library`):
- unified page with tabs: liked, playlists, albums
- nav changed from "liked" → "library"

**related**: scope upgrade OAuth flow (PR #503), settings consolidation (PR #496)

---

#### sensitive image moderation (PRs #471-488, Dec 5-6)

- `sensitive_images` table flags problematic images
- `show_sensitive_artwork` user preference
- flagged images blurred everywhere: track lists, player, artist pages, search, embeds
- Media Session API respects sensitive preference
- SSR-safe filtering for og:image link previews

---

#### teal.fm scrobbling (PR #467, Dec 4)

- native scrobbling to user's PDS using teal's ATProto lexicons
- scrobble at 30% or 30 seconds (same threshold as play counts)
- toggle in settings, link to pdsls.dev to view records

---

### Earlier December / November 2025

See `.status_history/2025-12.md` and `.status_history/2025-11.md` for detailed history including:
- unified search with Cmd+K (PR #447)
- light/dark theme system (PR #441)
- tag filtering and bufo easter egg (PRs #431-438)
- developer tokens (PR #367)
- copyright moderation system (PRs #382-395)
- export & upload reliability (PRs #337-344)
- transcoder API deployment (PR #156)

## immediate priorities

### high priority features
1. **audio transcoding pipeline integration** (issue #153)
   - ✅ standalone transcoder service deployed at https://plyr-transcoder.fly.dev/
   - ⏳ next: integrate into plyr.fm upload pipeline

### known issues
- playback auto-start on refresh (#225)
- no AIFF/AIF transcoding support (#153)
- iOS PWA audio may hang on first play after backgrounding

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

current monthly costs: ~$35-40/month

- fly.io backend (prod + staging): ~$10/month
- fly.io transcoder: ~$0-5/month (auto-scales to zero)
- neon postgres: $5/month
- audd audio fingerprinting: ~$10/month
- cloudflare pages + R2: ~$0.16/month
- logfire: $0 (free tier)
- domain: ~$1/month

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

- [deployment overview](docs/deployment/overview.md)
- [configuration guide](docs/configuration.md)
- [queue design](docs/queue-design.md)
- [logfire querying](docs/logfire-querying.md)
- [moderation & labeler](docs/moderation/atproto-labeler.md)
- [unified search](docs/frontend/search.md)
- [keyboard shortcuts](docs/frontend/keyboard-shortcuts.md)
- [lexicons overview](docs/lexicons/overview.md)

---

this is a living document. last updated 2025-12-08.
