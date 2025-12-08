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

#### playlist release fast-follow fixes (PRs #507-510, Dec 7)

**what shipped** (all merged to main):
- **PR #507**: include `image_url` in playlist SSR data for og:image link previews
- **PR #508**: invalidate layout data after token exchange - fixes stale auth state after login
- **PR #509**: playlist menus and link previews - fixed stopPropagation blocking links, added `/playlist/` to hasPageMetadata
- **PR #510**: inline playlist creation - replaced navigation-based create with inline form to avoid playback interruption

**the navigation bug** (PR #510):
- clicking "create new playlist" from AddToMenu/TrackActionsMenu previously navigated to `/library?create=playlist`
- this caused SvelteKit to reinitialize the layout, destroying the audio element and stopping playback
- fix: added inline create form that creates playlist and adds track in one action without navigation
- same pattern applied to TrackActionsMenu (mobile bottom sheet menu)

---

#### playlists, ATProto sync, and library hub (feat/playlists branch, PR #499, Dec 6-7)

**status**: shipped and deployed.

**playlists** (full CRUD):
- `playlists` and `playlist_tracks` tables with Alembic migration
- `POST /lists/playlists` - create playlist
- `PUT /lists/playlists/{id}` - rename playlist
- `DELETE /lists/playlists/{id}` - delete playlist
- `POST /lists/playlists/{id}/tracks` - add track to playlist
- `DELETE /lists/playlists/{id}/tracks/{track_id}` - remove track
- `PUT /lists/playlists/{id}/tracks/reorder` - reorder tracks
- `POST /lists/playlists/{id}/cover` - upload cover art
- playlist detail page (`/playlist/[id]`) with edit modal, drag-and-drop reordering
- playlists in global search results
- "add to playlist" menu on tracks (filters out current playlist when on playlist page)
- inline "create new playlist" in add-to menu (creates playlist and adds track in one action)
- playlist sharing with OpenGraph link previews

**ATProto integration**:
- `fm.plyr.list` lexicon for syncing playlists and albums to user PDSes
- `fm.plyr.actor.profile` lexicon for syncing artist profiles
- automatic sync of albums, liked tracks, and profile on login (fire-and-forget)
- scope upgrade OAuth flow for teal.fm integration (#503)

**library hub** (`/library`):
- unified page with tabs: liked, playlists, albums
- create playlist modal with inline form
- consistent card layouts across sections
- nav changed from "liked" → "library"

**design decisions**:
- lists are generic ordered collections of any ATProto records
- `listType` semantically categorizes (album, playlist, liked) but doesn't restrict content
- array order = display order, reorder via `putRecord`
- strongRef (uri + cid) for content-addressable item references
- "library" = umbrella term for personal collections

**sync architecture**:
- **profile, albums, liked tracks**: synced on login via `GET /artists/me` (fire-and-forget background tasks)
- **playlists**: synced on create/modify (not at login) - avoids N playlist syncs on every login
- sync tasks don't block the response (~300-500ms for the endpoint, PDS calls happen in background)
- putRecord calls take ~50-100ms each, with automatic DPoP nonce retry on 401

**related issues**: #221, #146, #498

---

### November-December 2025

See `.status_history/2025-11.md` for detailed development history including:
- settings consolidation (PR #496, Dec 6)
- bufo easter egg improvements (PRs #491-492, Dec 6)
- mobile artwork upload fix (PR #489, Dec 6)
- sensitive image moderation (PRs #471-488, Dec 5-6)
- teal.fm scrobbling integration (PR #467, Dec 4)
- unified search with Cmd+K (PR #447, Dec 3)
- light/dark theme and mobile UX overhaul (Dec 2-3)
- tag filtering system (Dec 2)
- ATProto labeler and copyright moderation (PRs #382-395, Nov 29-Dec 1)
- developer tokens with independent OAuth grants (PR #367, Nov 28)
- platform stats and media session integration (PRs #359-379, Nov 27-29)
- export & upload reliability (PRs #337-344, Nov 24)
- async I/O performance fixes (PRs #149-151, Nov 10-11)
- transcoder API deployment (PR #156, Nov 11)
- liked tracks feature (PR #157, Nov 11)
- track detail pages (PR #164, Nov 12)

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
- no AIFF/AIF transcoding support (#153)
- iOS PWA audio may hang on first play after backgrounding - service worker caching interacts poorly with 307 redirects to R2 CDN. PR #466 added `NetworkOnly` for audio routes which should fix this, but iOS PWAs are slow to update service workers. workaround: delete home screen bookmark and re-add. may need further investigation if issue persists after SW propagates.

### new features
- issue #146: content-addressable storage (hash-based deduplication)
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

### what's working

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
- ✅ unified search with Cmd/Ctrl+K (fuzzy matching via pg_trgm)
- ✅ teal.fm scrobbling (records plays to user's PDS)
- ✅ light/dark theme with system preference support
- ✅ tag filtering system with user-configurable hidden tags

**albums**
- ✅ album database schema with track relationships
- ✅ album browsing and detail pages
- ✅ album cover art upload and display
- ✅ server-side rendering for SEO
- ✅ ATProto list records for albums (auto-synced on login)

**playlists**
- ✅ full CRUD (create, rename, delete, reorder tracks)
- ✅ playlist detail pages with drag-and-drop reordering
- ✅ playlist cover art upload
- ✅ ATProto list records (synced on create/modify)
- ✅ "add to playlist" menu on tracks
- ✅ playlists in global search results

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
3. run backend: `just backend run`
4. run frontend: `just frontend dev`
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
- [unified search](docs/frontend/search.md)
- [keyboard shortcuts](docs/frontend/keyboard-shortcuts.md)

---

this is a living document. last updated 2025-12-08.
