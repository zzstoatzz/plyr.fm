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

### January 2026

#### per-track PDS migration + UX polish (PRs #835-839, Jan 30-31)

**selective migration**: replaced all-or-nothing PDS backfill with a modal where users pick individual tracks to migrate. modal shows file sizes (via R2 HEAD requests), track status badges (on PDS / gated / eligible), and a select-all toggle.

**non-blocking UX (PR #839)**: the modal initially blocked the user during migration. reworked so the modal is selection-only — picks tracks, fires a callback, closes immediately. POST + SSE progress tracking moved to the parent component with persistent toast updates ("migrating 3/7...", "5 migrated, 2 skipped"). user is never trapped.

**backend changes (PR #838)**:
- `GET /tracks/me/file-sizes` — parallel R2 HEAD requests (semaphore-capped at 10) to get byte sizes for the migration modal
- `POST /pds-backfill/audio` now accepts optional `track_ids` body to backfill specific tracks (backward-compatible — no body = all eligible)
- SSE progress stream includes `last_processed_track_id` and `last_status` for per-track updates

**copy fixes (PRs #835-836)**: removed "R2" from user-facing text (settings toggle, upload notes). users see "plyr.fm storage" instead of infrastructure detail.

**share link clutter (PR #837)**: share links with zero interactions (self-clicks filtered) were cluttering the portal stats section. now hidden until someone else actually clicks the link.

---

#### PDS blob storage for audio (PRs #823-833, Jan 29)

**audio files can now be stored on the user's PDS** - embraces ATProto's data ownership model. PDS uploads are feature-flagged and opt-in via a user setting, with R2 CDN as the primary delivery path.

**core implementation (PR #823)**:
- new uploads: audio blob uploaded to PDS, BlobRef stored in track record
- dual-write: R2 copy kept for streaming performance (PDS `getBlob` isn't CDN-optimized)
- graceful fallback: if PDS rejects blob (size limit), track stays R2-only
- gated tracks skip PDS (need auth-protected access)

**database changes**:
- `audio_storage`: "r2" | "pds" | "both"
- `pds_blob_cid`: CID of blob on user's PDS
- `pds_blob_size`: size in bytes

**bug fixes and hardening (PRs #824-828)**:
- fix atproto headers lost on DPoP retry (#824)
- fail upload on unexpected PDS errors instead of silent fallback (#825)
- add `blob:*/*` OAuth scope to both permission sets and granular paths (#826, #827)
- remove PDS indicator from track UI — PDS will be the default, no need to badge it (#828)

**batch backfill (PR #829)**: `POST /pds-backfill/audio` starts a background job (docket) to backfill existing tracks to the user's PDS with SSE progress streaming. frontend `PdsBackfillControl` component in the portal.

**copyright DM fix (PR #831)**: removed misleading "0% confidence" from copyright notification DMs — the enterprise AudD API doesn't return confidence values.

**feature flag gating (PR #833)**: PDS uploads during track upload are now gated behind two checks: admin-assigned `pds-audio-uploads` feature flag + per-user toggle in Settings > Experimental. default behavior is R2-only unless both are enabled.

**terms update (PR #832)**: clarified PDS delisting language in terms of service.

**research**: documented emerging ATProto media service patterns from [community discourse](https://discourse.atprotocol.community/t/media-pds-service/297) — the ecosystem is converging on dedicated sidecar media services rather than PDS-as-media-host. our layered architecture (R2 + CDN + PDS records) aligns well. see `docs/research/2026-01-29-atproto-media-service-patterns.md`.

---

#### PDS-based account creation (PRs #813-815, Jan 27)

**create ATProto accounts directly from plyr.fm** - users without an existing ATProto identity can now create one during sign-up by selecting a PDS host.

**how it works**:
- login page shows "create account" tab when feature is enabled
- user selects a PDS (currently selfhosted.social)
- OAuth flow uses `prompt=create` to trigger account creation on the PDS
- after account creation, user is redirected back and logged in

**implementation details**:
- `/auth/pds-options` endpoint returns available PDS hosts from config
- `/auth/start` accepts `pds_url` parameter for account creation flow
- handle resolution falls back to PDS directly (via `com.atproto.repo.describeRepo`) when Bluesky AppView hasn't indexed the new account yet

**configuration** (`AccountCreationSettings`):
- `enabled`: feature flag for account creation
- `recommended_pds`: list of PDS options with name, url, and description

---

#### lossless audio support (PRs #794-801, Jan 25)

**transcoding integration complete** - users can now upload AIFF and FLAC files. the system transcodes them to MP3 for browser compatibility while preserving originals for lossless playback.

**how it works**:
- upload AIFF/FLAC → original saved to R2, transcoded MP3 created
- database stores both `file_id` (transcoded) and `original_file_id` (lossless)
- frontend detects browser capabilities via `canPlayType()`
- Safari/native apps get lossless, Chrome/Firefox get transcoded MP3
- lossless badge shown on track cards when browser supports the format

**key changes**:
- `original_file_id` and `original_file_type` added to Track model and API
- audio endpoint serves either version based on requested file_id
- feature-flagged via `lossless-uploads` user flag

**bug fixes during rollout**:
- PR #796: audio endpoint now queries by `file_id` OR `original_file_id`
- PR #797: store actual extension (`.aif`) not normalized format name (`.aiff`)

**UI polish (PRs #799-801)**:
- lossless badge positioned in top-right corner of track card (not artwork)
- subtle glowing animation draws attention to premium quality tracks
- whole card gets accent-colored border treatment when lossless
- theme-aware styling, responsive sizing, respects `prefers-reduced-motion`

---

#### auth check optimization (PRs #781-782, Jan 23)

**eliminated redundant /auth/me calls** - previously, every navigation triggered an auth check via the layout load function. for unauthenticated users, this meant a 401 on every page click (117 errors in 24 hours observed via Logfire).

**fix**: auth singleton now tracks initialization state. `+layout.svelte` checks auth once on mount instead of every navigation. follow-up PR fixed library/liked pages that were broken by the layout simplification (they were using `await parent()` to get `isAuthenticated` which was no longer provided).

---

#### remove SSR sensitive-images fetch (PR #785, Jan 24)

**eliminated unnecessary SSR fetch** - the frontend SSR (`+layout.server.ts`) was fetching `/moderation/sensitive-images` on every page load to pre-populate the client-side moderation filter. during traffic spikes, this hammered the backend (1,179 rate limit hits over 7 days).

**root cause**: the SSR fetch was premature optimization. cloudflare pages workers make direct fetch calls to fly.io - there's no CDN layer to cache responses. the cache-control headers we added in PR #784 only help browser caching, not SSR-to-origin requests.

**fix**: removed the SSR fetch entirely. the client-side `ModerationManager` singleton already has caching and will fetch the data once on page load. the "flash of sensitive content" risk is theoretical - images load slower than a single API call completes, and there are only 2 flagged images.

- deleted `+layout.server.ts`
- simplified `+layout.ts`
- updated pages to use `moderation.isSensitive()` singleton instead of SSR data

---

#### listen receipts (PR #773, Jan 22)

**share links now track who clicked and played** - when you share a track, you get a URL with a `?ref=` code that records visitors and listeners:
- `POST /tracks/{id}/share` creates tracked share link with unique 8-character code (48 bits entropy)
- frontend captures `?ref=` param on page load, fires click event to backend
- play endpoint accepts optional `ref` param to record play attribution
- `GET /tracks/me/shares` returns paginated stats: visitors, listeners, anonymous counts

**portal share stats section**:
- expandable cards per share link with copyable tracked URL
- visitors (who clicked) and listeners (who played) shown as avatar circles
- individual interaction counts per user
- self-clicks/plays filtered out to avoid inflating stats

**data model**:
- `ShareLink` table: code, track_id, creator_did, created_at
- `ShareLinkEvent` table: share_link_id, visitor_did (nullable for anonymous), event_type (click/play)

---

#### handle display fix (PR #774, Jan 22)

**DIDs were displaying instead of handles** in share link stats and other places (comments, track likers):
- root cause: Artist records were only created during profile setup
- users who authenticated but skipped setup had no Artist record
- fix: create minimal Artist record (did, handle, avatar) during OAuth callback
- profile setup now updates existing record instead of erroring

---

#### responsive embed v2 (PRs #771-772, Jan 20-21)

**complete rewrite of embed CSS** using container queries and proportional scaling:

**layout modes**:
- **wide** (width >= 400px): side art, proportional sizing
- **very wide** (width >= 600px): larger art, more breathing room
- **square/tall** (aspect <= 1.2, width >= 200px): art on top, 2-line titles
- **very tall** (aspect <= 0.7, width >= 200px): blurred background overlay
- **narrow** (width < 280px): compact blurred background
- **micro** (width < 200px): hide time labels and logo

**key technical changes**:
- all sizes use `clamp()` with `cqi` units (container query units)
- grid-based header layout instead of absolute positioning
- gradient overlay (top-heavy to bottom-heavy) for text readability

---

#### terms of service and privacy policy (PRs #567, #761-770, Jan 19-20)

**legal foundation shipped** with ATProto-aware design:

**terms cover**:
- AT Protocol context (decentralized identity, user-controlled PDS)
- content ownership (users retain ownership, plyr.fm gets license for streaming)
- DMCA safe harbor with designated agent (DMCA-1069186)
- federation disclaimer: audio files in blob storage we control, but ATProto records may persist on user's PDS

**privacy policy**:
- explicit third-party list with links (Cloudflare, Fly.io, Neon, Logfire, AudD, Anthropic, ATProtoFans)
- data ownership clarity (DID, profile, tracks on user's PDS)
- MIT license added to repo

**acceptance flow** (TermsOverlay component):
- shown on first login if `terms_accepted_at` is null
- 4-bullet summary with links to full documents
- "I Accept" or "Decline & Logout" options
- `POST /account/accept-terms` records timestamp

**polish PRs** (#761-770): corrected ATProto vs "our servers" terminology, standardized AT Protocol naming, added email fallbacks, capitalized sentence starts

---

#### content gating research (Jan 18)

researched ATProtoFans architecture and JSONLogic rule evaluation. documented findings in `docs/content-gating-roadmap.md`:
- current ATProtoFans records and API (supporter, supporterProof, brokerProof, terms)
- the gap: terms exist but aren't exposed via validateSupporter
- how magazi uses datalogic-rs for flexible rule evaluation
- open questions about upcoming metadata extensions

no implementation changes - waiting to align with what ATProtoFans will support.

#### logout modal UX (PRs #755-757, Jan 17-18)

**tooltip scroll fix** (PR #755):
- leftmost avatar in likers/commenters tooltip was clipped with no way to scroll to it
- changed `justify-content: center` to `flex-start` so most recent (leftmost) is always visible

**logout modal copy** (PRs #756-757):
- simplified from two confusing questions to one clear question
- before: "stay logged in?" + "you're logging out of @handle?"
- after: "switch accounts?"
- "logout completely" → "log out of all accounts"

---

#### idempotent teal scrobbles (PR #754, Jan 16)

**prevents duplicate scrobbles** when same play is submitted multiple times:
- use `putRecord` with deterministic TID rkeys derived from `playedTime` instead of `createRecord`
- network retries, multiple teal-compatible services, or background task retries won't create duplicates
- adds `played_time` parameter to `build_teal_play_record` for deterministic record keys

---

#### avatar refresh and tooltip polish (PRs #750-752, Jan 13)

**avatar refresh from anywhere** (PR #751):
- previously, stale avatar URLs were only fixed when visiting the artist detail page
- now any broken avatar triggers a background refresh from Bluesky
- shared `avatar-refresh.svelte.ts` provides global cache and request deduplication
- works from: track items, likers tooltip, commenters tooltip, profile page

**interactive tooltips** (PR #750):
- hovering on like count shows avatar circles of users who liked
- hovering on comment count shows avatar circles of commenters
- lazy-loaded with 5-minute cache, invalidated when likes/comments change
- elegant centered layout with horizontal scroll when needed

**UX polish** (PR #752):
- added prettier config with `useTabs: true` to match existing style
- reduced avatar hover effect intensity (scale 1.2 → 1.08)
- fixed avatar hover clipping at tooltip edge (added top padding)
- track title now links to detail page (color change on hover)

---

#### copyright flagging fix (PR #748, Jan 12)

**switched from score-based to dominant match detection**:
- AudD's enterprise API doesn't return confidence scores (always 0)
- previous threshold-based detection was broken
- new approach: flag if one song appears in >= 30% of matched segments
- filters false positives where random segments match different songs

---

#### Neon cold start fix (Jan 11)

**why**: first requests after idle periods would fail with 500 errors due to Neon serverless scaling to zero after 5 minutes of inactivity. previous mitigations (larger pool, longer timeouts) helped but didn't eliminate the problem.

**fix**: disabled scale-to-zero on `plyr-prd` via Neon console. this is the [recommended approach](https://neon.com/blog/6-best-practices-for-running-neon-in-production) for production workloads.

**configuration**:
- `plyr-prd`: scale-to-zero **disabled** (`suspend_timeout_seconds: -1`)
- `plyr-stg`, `plyr-dev`: scale-to-zero enabled (cold starts acceptable)

**docs**: updated [connection-pooling.md](docs/backend/database/connection-pooling.md) with production guidance and how to verify settings via Neon MCP.

closes #733

---

#### early January work (Jan 1-9)

See `.status_history/2026-01.md` for detailed history including:
- multi-account experience (PRs #707, #710, #712-714, Jan 3-5)
- integration test harness (PR #744, Jan 9)
- track edit UX improvements (PRs #741-742, Jan 9)
- auth stabilization (PRs #734-736, Jan 6-7)
- timestamp deep links (PRs #739-740, Jan 8)
- artist bio links (PRs #700-701, Jan 2)
- copyright moderation improvements (PRs #703-704, Jan 2-3)
- ATProto OAuth permission sets (PRs #697-698, Jan 1-2)
- atprotofans supporters display (PRs #695-696, Jan 1)
- UI polish (PRs #692-694, Dec 31 - Jan 1)

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

ML-powered track features rolling out: genre classification (Replicate effnet-discogs) auto-runs on upload, with optional auto-tagging checkbox on the upload form. mood search (CLAP embeddings + turbopuffer) feature-flagged behind `vibe-search`. ML audit script (`scripts/ml_audit.py`) tracks which tracks/artists have been processed for privacy/ToS compliance.

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

this is a living document. last updated 2026-02-07.
