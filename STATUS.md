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

#### embed glow bar + share button (PRs #996-998, Mar 1)

**glow bar**: 1px accent-colored bar (`#6a9fff`) on track and collection embeds that lights up on playback and dims on pause, matching the main Player's `::before` style. uses `color-mix()` for the box-shadow glow. works across all container query breakpoints.

**share button**: inline link icon next to the logo that copies the plyr.fm page URL (not the embed URL) to clipboard with "copied!" tooltip feedback. falls back to `navigator.share()` when clipboard API is unavailable. no auth dependency. hidden in MICRO mode, white-themed in blurred-bg modes (NARROW, SQUARE/TALL).

**embed layout fixes** (PRs #996-997): fixed track embed clipping at short heights, guarded collection WIDE query, and fixed track embed layout for tall/portrait containers.

---

### February 2026

#### image thumbnails + storage cleanup (PRs #976-979, Feb 27)

**96x96 WebP thumbnails for artwork**: track artwork and avatars display at 48px but full-resolution images (potentially megabytes) were being served. now generates a 96x96 WebP thumbnail (2x retina) on upload, stored as `images/{file_id}_thumb.webp` alongside the original. Pillow handles center-crop, LANCZOS resize, WebP encode. nullable `thumbnail_url` column on tracks, albums, and playlists. frontend falls back to `image_url` when `thumbnail_url` is null, so partially-backfilled states are safe. `generate_and_save()` helper wired into all image upload paths: track uploads, album covers, playlist covers, and track metadata edits.

**storage protocol**: new `StorageProtocol` with `@runtime_checkable` formalizes the R2Storage contract. `build_image_url()` constructs public URLs without HEAD checks (caller knows the image exists). `save_thumbnail()` uploads WebP data to the image bucket. storage proxy typed as `StorageProtocol` in `__init__.py`. export_tasks decoupled from `settings.storage` — uses `storage.audio_bucket_name` instead.

**backfill script**: `scripts/backfill_thumbnails.py` follows the embeddings backfill pattern (`--dry-run`, `--limit`, `--concurrency`). queries tracks/albums/playlists where `image_id IS NOT NULL AND thumbnail_url IS NULL`, downloads originals via httpx, generates thumbnails, uploads to R2, updates DB rows.

9 thumbnail tests, 5 storage protocol/regression tests. 533 total tests pass.

---

#### jam polish + feature flag graduations (PRs #963-975, Feb 25-27)

**jam UX fixes** (PRs #963-964): eliminated the "no output" state — auto-claim output when nobody has it. restructured jam header UI.

**feature flag removals** (PRs #965, #969): jams and PDS audio uploads graduated to GA — available to all users without flags.

**data fix** (PR #966): `support_gate` JSONB null vs SQL NULL — gated tracks were invisible to backfill queries because `IS NULL` doesn't match JSONB `null`. fixed with `none_as_null=True`.

**loading state polish** (PR #972): fade transitions and `prefers-reduced-motion` support across loading states.

**network artists perf** (PRs #970, #973-975): Bluesky follow graph cached in Redis. parallelized network artists fetch with other homepage data. module-level cache persists across navigations. fixed auth race where fetch fired before session was ready.

---

#### unified queue/jam architecture + output device (PRs #949-960, Feb 19-25)

**jams — shared listening rooms (PR #949)**: real-time shared listening rooms. one user creates a jam, gets a shareable code (`plyr.fm/jam/a1b2c3d4`), and anyone with the link can join. all participants control playback. `Jam` and `JamParticipant` models with partial indexes. `JamService` singleton manages lifecycle, WebSocket connections, and Redis Streams fan-out. playback state is server-authoritative — JSONB with monotonic revision counter. server-timestamp + client interpolation for sync. reconnect replays missed events via `XRANGE`, falls back to full DB snapshot if trimmed. personal queue preserved and restored on leave. gated behind `jams` feature flag. see `docs/architecture/jams.md`.

**output device — single-speaker mode (PR #953)**: one participant's browser plays audio, everyone else is a remote control. `output_client_id` / `output_did` in jam state with `set_output` command. auto-set to host on first WS sync. output clears + pauses when the output device disconnects or leaves. "play here" button transfers audio to any participant. fixed three browser-level playback bugs during integration: autoplay policy (WS round-trip broke user gesture context), audio event fight (drift correction seeking triggered pause/play loop), and output transfer (old device didn't stop audio on transfer).

**jam queue unification (PR #960)**: a jam is just a shared queue — the backend shouldn't reimplement queue manipulation. replaced ~100 lines of duplicated backend queue logic (`next`, `previous`, `add_tracks`, `remove_track`, `move_track`, `clear_upcoming`, `play_track`, `set_index`) with a single `update_queue` command. frontend does all mutation locally (same code path for solo and jam), then pushes the resulting state. `JamBridge` simplified from 11 methods to 4 (`pushQueueState`, `play`, `pause`, `seek`). enables `setQueue`, `clear`, and `playNow` in jams for free. net -189 lines.

**reliability fixes**: deepcopy jam state to prevent shallow-copy clobber — `dict(jam.state)` shared nested list references, so in-place mutations went undetected by SQLAlchemy (PR #959). prevented personal queue fetch from overwriting jam state (PR #952). surfaced backend error detail on jam join failure (PR #951).

42 backend tests covering lifecycle, all commands, output device, cross-client sync, revision monotonicity, flag gating.

---

#### ATProto spec-compliant scope parsing (PRs #955, #957, Feb 24)

replaced naive set-subset scope checking with `ScopesSet` from the atproto SDK. handles the full ATProto permission grammar: positional/query format equivalence (`repo:nsid` == `repo?collection=nsid`), wildcard matching (`repo:*`), action filtering, and MIME patterns for blob scopes. follow-up fix for `include:` scope expansion — PDS servers expand `include:ns.permSet` into granular `repo:`/`rpc:` scopes, so the granted scope never contains the literal `include:` token. was causing 403 `scope_upgrade_required` for all sessions on staging. fix checks namespace authority via `IncludeScope.is_parent_authority_of()` instead of exact string match. 21 scope tests.

---

#### persist playback position (PR #948, Feb 19)

playback position survives page reloads and session restores. `progress_ms` stored in `QueueState` JSON (zero backend changes — backend stores and returns the dict verbatim). Player syncs `currentTime` → `queue.progressMs` via `$effect`. on page close/hide, `flushSync()` pushes with `keepalive: true` so the fetch survives page teardown. on restore, `loadeddata` handler seeks to saved position (skips if near end of track). 30s periodic save for crash resilience.

---

#### copyright DM fix (PRs #941-942, Feb 16-17)

upload notification DMs were incorrectly going to artists when copyright flags were raised. stopped DMing artists about copyright flags, restored admin-only DM notification so copyright issues go to the right people.

---

#### hidden tag filter autocomplete (PR #945, Feb 18)

the homepage hidden tag filter's "add tag" input now has autocomplete. typing a partial tag name fetches matching tags from `GET /tracks/tags?q=...` (same endpoint the portal tag editor uses) with a 200ms debounce. suggestions appear in a compact glass-effect dropdown showing tag name and track count. supports keyboard navigation (arrow keys to cycle, enter to select, escape to close) and mouse selection. tags already in the hidden list are filtered out of suggestions. frontend-only change.

---

#### supporter avatar fallback (PR #943, Feb 17)

atprotofans supporter avatars on artist profiles (e.g. goose.art) showed only initial letters for supporters who have Bluesky accounts but haven't used plyr.fm. root cause: `POST /artists/batch` only returns DIDs in our database, so non-plyr.fm supporters got no `avatar_url`. fix: fall back to constructing a Bluesky CDN URL from the atprotofans API's avatar blob data (`avatar.ref.$link` CID → `cdn.bsky.app/img/avatar/plain/{did}/{cid}@jpeg`). frontend-only change.

---

#### liked tracks empty state fix (PRs #938-939, Feb 17)

both `/liked` and `/u/[handle]/liked` showed redundant headings when the track list was empty — the section header ("liked tracks" / "no liked tracks") duplicated the empty state message below it. moved section headers inside the tracks-exist branch so only the empty state (heart icon + contextual message) renders when there are no likes.

---

#### Dockerfile fix + album caching + session caching (PRs #930-935, Feb 16-17)

**production stability fix (PR #935)**: `uv run` in the Dockerfile CMD was triggering dependency resolution on every cold start, downloading from PyPI inside the Fly network. when PyPI connections failed (connection reset), the process exited, Fly restarted it, and the machine eventually hit the 10-restart limit and died permanently — leaving only one machine to serve all traffic. fix: `--no-sync` flag tells `uv run` to use the pre-installed venv without any runtime resolution.

**album detail caching (PRs #933-934)**: `GET /albums/{handle}/{slug}` averaged 745ms with outliers at 5-7s due to Neon cold compute + uncached PDS calls. added Redis read-through cache on the full `AlbumResponse` (5-min TTL, keyed by handle/slug). per-user `is_liked` state zeroed out before caching to prevent leaking between users. explicit invalidation on all mutation paths: album CRUD, track CRUD, list reorder. follow-up PR #934 fixed three gaps caught in review: reorder not invalidating, same-album metadata edits not invalidating, and delete invalidating before commit (race condition).

**session cache expiry fix (PR #932)**: Redis session cache from PR #930 was returning expired sessions — the cache read skipped the `expires_at` check. fix: validate expiry on cache hits, delete and fall through to DB on stale entries.

**session caching (PR #930)**: Redis read-through cache for `get_session()` to reduce Neon cold-start latency on auth checks. 5-min TTL with invalidation on session mutations.

---

#### homepage quality pass + likers bottom sheet (PRs #913-927, Feb 16)

**top tracks redesign**: the homepage "top tracks" section now uses horizontal `TrackCard` components (row layout with 48px artwork, title/artist links, play/like counts) inside a scroll-snap container. cards use the same `--track-*` glass design tokens as `TrackItem` for visual consistency. scroll-snap with `x proximity` gives gentle anchoring without fighting the user.

**likers bottom sheet**: hover tooltips for showing who liked a track were fundamentally broken on mobile — `position: fixed` gets trapped by ancestor `transform`/`transition` containing blocks inside `overflow-x: auto` scroll containers. replaced with a bottom sheet on mobile (slides up from bottom, renders at root level in `+layout.svelte` to escape all overflow/stacking contexts). desktop keeps the hover tooltip. the `(max-width: 768px)` breakpoint gates the behavior, matching the rest of the app. applied consistently across all three locations: `TrackCard`, `TrackItem`, and the track detail page.

**"artists you know" section** (PRs #910-912, #927): new homepage section showing artists from your Bluesky follow graph. backend endpoint `GET /discover/network` cross-references follows with artists who have tracks on plyr.fm, ordered by follow age (oldest first). avatar refresh integration added after discovering stale DB URLs were preferred over fresh Bluesky URLs — flipped the `or` preference so the live follow-graph avatar wins.

---

#### oEmbed + collection embeds (PRs #903-909, Feb 13-14)

**oEmbed support**: tracks, playlists, and albums now return oEmbed JSON for rich link previews. iframe embed player redesigned for collections — inline header with artwork, now-playing title links to source, narrow mode for small embeds.

**misc fixes**: "ai-slop" added to default hidden tags filter. "create new playlist" CTA hoisted above existing playlists in picker. button text wrapping fixed.

---

See `.status_history/2026-02.md` for Feb 2-12 history including:
- playlist track recommendations via CLAP embeddings (PRs #895-898)
- main.py extraction + bug fixes (PRs #890-894)
- OAuth permission set cleanup + docs audit (PRs #888-889)
- auth state refresh + backend package split (PRs #886-887)
- portal pagination + perf optimization (PRs #878-879)
- repo reorganization (PR #876)
- auto-tag at upload + ML audit (PRs #870-872)
- ML genre classification + suggested tags (PRs #864-868)
- mood search via CLAP + turbopuffer (PRs #848-858)
- recommended tags via audio similarity (PR #859)
- mobile login UX + misc fixes (PRs #841-845)

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

jams shipped to all users — feature flag removed, output device mode (single-speaker) working. image performance: 96x96 WebP thumbnails for all artwork with storage protocol abstraction and backfill script. PDS audio uploads graduated to GA. homepage performance improved with Redis-cached follow graph and parallelized network artists fetch. ATProto scope parsing replaced with spec-compliant SDK implementation.

### known issues
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
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

this is a living document. last updated 2026-03-01 (embed glow bar + share button, embed layout fixes).

