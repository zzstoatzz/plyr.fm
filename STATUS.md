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

### January 2026

#### multi-account experience (PRs #707, #713-714, Jan 3-5)

**users can now link multiple Bluesky accounts** to a single browser session:
- add additional accounts via "add account" in user menu (triggers OAuth with `prompt=login`)
- switch between linked accounts instantly without re-authenticating
- logout from individual accounts or all at once
- updated `/auth/me` returns `linked_accounts` array with avatars

**backend changes**:
- new `group_id` column on `user_sessions` links accounts together
- new `pending_add_accounts` table tracks in-progress OAuth flows
- new endpoints: `POST /auth/add-account/start`, `POST /auth/switch-account`, `POST /auth/logout-all`

**performance fixes** (PRs #710, #712, #714):
- identified Neon serverless connection overhead (~77ms per connection) via Logfire
- cached `async_sessionmaker` per engine instead of recreating on every request
- changed `_refresh_locks` from unbounded dict to LRUCache (10k max, 1hr TTL) to prevent memory leak
- pass db session through auth helpers to reduce connections per request (3→2)
- result: `/auth/switch-account` ~1100ms → ~800ms, `/auth/me` ~940ms → ~720ms

**frontend changes**:
- UserMenu (desktop): collapsible accounts submenu with linked accounts, add account, logout all
- ProfileMenu (mobile): dedicated accounts panel with avatars
- fixed `invalidateAll()` not refreshing client-side loaded data by using `window.location.reload()`

**docs**: [research/2026-01-03-multi-account-experience.md](docs/research/2026-01-03-multi-account-experience.md)

---

#### copyright moderation improvements (PRs #703-704, Jan 2-3)

redesigned copyright handling to reduce liability:
- **disabled auto-labeling**: labels no longer emitted automatically. system flags and notifies, humans decide on takedowns
- **raised threshold**: configurable score (default 85%) via `MODERATION_COPYRIGHT_SCORE_THRESHOLD`
- **DM notifications**: artists and admin receive Bluesky DMs when tracks are flagged
- **notification tracking**: `notified_at` field on `copyright_scans` tracks which flags have been communicated

---

#### artist bio links (PRs #700-701, Jan 2)

**links in artist bios now render as clickable** - supports full URLs and bare domains (e.g., "example.com"):
- regex extracts URLs from bio text
- bare domain/path URLs handled correctly
- links open in new tab

---

#### ATProto OAuth permission sets (PRs #697-698, Jan 1-2)

**permission sets enabled** - OAuth now uses `include:fm.plyr.authFullApp` instead of listing individual scopes:
- users see clean "plyr.fm" permission title instead of raw collection names
- permission set lexicon published to `com.atproto.lexicon.schema` on plyr.fm authority repo
- DNS TXT records at `_lexicon.plyr.fm` and `_lexicon.stg.plyr.fm` link namespaces to authority DID

**docs**: [lexicons/overview.md](docs/lexicons/overview.md), [research/2026-01-01-atproto-oauth-permission-sets.md](docs/research/2026-01-01-atproto-oauth-permission-sets.md)

---

#### atprotofans supporters display (PRs #695-696, Jan 1)

**supporters visible on artist pages** - compact overlapping avatar circles with "+N" overflow:
- `POST /artists/batch` endpoint enriches supporter DIDs with avatar_url
- clicks link to supporter's plyr.fm artist page

---

### December 2025

#### header redesign and UI polish (PRs #691-694, Dec 31)

- **new header layout** (PR #691): UserMenu dropdown with even spacing
- **feed/library toggle** (PR #692): consistent header toggle between views
- **shuffle moved** (PR #693): shuffle button now in queue component
- **justfile consistency** (PR #694): standardized `just run` across modules

---

#### automated image moderation (PRs #687-690, Dec 31)

**Claude vision integration** for sensitive image detection:
- images analyzed on upload via Claude Sonnet 4.5
- flagged images trigger DM notifications to admin
- non-false-positive flags sent to batch review queue

---

#### top tracks homepage (PR #684, Dec 31)

**homepage now shows top tracks** - quick access to popular content for new visitors.

---

#### avatar sync on login (PR #685, Dec 31)

**avatars now stay fresh** - on login, avatar is refreshed from Bluesky and synced to both postgres and ATProto profile record.

---

#### batch review system (PR #672, Dec 30)

**moderation batch review UI** - mobile-friendly interface for reviewing flagged content:
- filter by flag status, paginated results
- auto-resolve flags for deleted tracks
- full URL in DM notifications

---

#### CSS design tokens (PRs #662-664, Dec 29-30)

**design system foundations**:
- border-radius tokens (`--radius-sm`, `--radius-md`, etc.)
- typography scale tokens
- consolidated form styles
- documented in `docs/frontend/design-tokens.md`

---

#### self-hosted redis (PRs #674-675, Dec 30)

**replaced Upstash with self-hosted Redis on Fly.io** - ~$75/month → ~$4/month:
- Upstash pay-as-you-go was charging per command (37M commands = $75)
- self-hosted Redis on 256MB Fly VMs costs fixed ~$2/month per environment
- deployed `plyr-redis` (prod) and `plyr-redis-stg` (staging)
- added CI workflow for redis deployments on merge

**no state migration needed** - docket stores ephemeral task queue data, job progress lives in postgres.

---

#### supporter-gated content (PR #637, Dec 22-23)

**atprotofans paywall integration** - artists can now mark tracks as "supporters only":
- tracks with `support_gate` require atprotofans validation before playback
- non-supporters see lock icon and "become a supporter" CTA linking to atprotofans
- artists can always play their own gated tracks

**backend architecture**:
- audio endpoint validates supporter status via atprotofans API before serving gated content
- HEAD requests return 200/401/402 for pre-flight auth checks (avoids CORS issues)
- `R2Storage.move_audio()` moves files between public/private buckets when toggling gate
- background task handles bucket migration asynchronously
- ATProto record syncs when toggling gate (updates `supportGate` field and `audioUrl`)

**frontend**:
- `playback.svelte.ts` guards queue operations with gated checks BEFORE modifying state
- clicking locked track shows toast with CTA - does NOT interrupt current playback
- portal shows support gate toggle in track edit UI

---

#### supporter badges (PR #627, Dec 21-22)

**phase 1 of atprotofans integration**:
- supporter badge displays on artist pages when logged-in viewer supports the artist
- calls atprotofans `validateSupporter` API directly from frontend (public endpoint)
- badge only shows when viewer is authenticated and not viewing their own profile

---

#### rate limit moderation endpoint (PR #629, Dec 21)

**incident response**: detected suspicious activity - 72 requests in 17 seconds from a single IP targeting `/moderation/sensitive-images`. added `10/minute` rate limit using existing slowapi infrastructure.

---

#### beartype + moderation cleanup (PRs #617-619, Dec 19)

**runtime type checking** (PR #619):
- enabled beartype runtime type validation across the backend
- catches type errors at runtime instead of silently passing bad data
- test infrastructure improvements: session-scoped TestClient fixture (5x faster tests)

**moderation cleanup** (PRs #617-618):
- consolidated moderation code, addressing issues #541-543
- `sync_copyright_resolutions` now runs automatically via docket Perpetual task
- removed dead `init_db()` from lifespan (handled by alembic migrations)

---

#### UX polish (PRs #604-607, #613, #615, Dec 16-18)

**login improvements** (PRs #604, #613):
- login page now uses "internet handle" terminology for clarity
- input normalization: strips `@` and `at://` prefixes automatically

**artist page fixes** (PR #615):
- track pagination on artist pages now works correctly
- fixed mobile album card overflow

**mobile + metadata** (PRs #605-607):
- Open Graph tags added to tag detail pages for link previews
- mobile modals now use full screen positioning
- fixed `/tag/` routes in hasPageMetadata check

---

#### offline mode foundation (PRs #610-611, Dec 17)

**experimental offline playback**:
- storage layer using Cache API for audio bytes + IndexedDB for metadata
- `GET /audio/{file_id}/url` backend endpoint returns direct R2 URLs for client-side caching
- "auto-download liked" toggle in experimental settings section
- Player checks for cached audio before streaming from R2

---

### Earlier December 2025

See `.status_history/2025-12.md` for detailed history including:
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

stabilization and polish after the multi-account release. monitoring production for any issues.

### known issues
- playback auto-start on refresh (#225)
- iOS PWA audio may hang on first play after backgrounding

### backlog
- audio transcoding pipeline integration (#153) - transcoder deployed, integration deferred
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable moderation rules engine
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
- ✅ supporter-gated content via atprotofans

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

this is a living document. last updated 2026-01-05.
