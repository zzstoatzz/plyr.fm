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

### June 2026

#### permissioned-data pivot: the protocol member list was removed (#1573 → PR #1574, June 10)

**why**: the load-bearing caveat made real — the `com.atproto.space.*` design is an *unfinished proposal*, and it moved. Per the upstream thread ([removing the member list](https://discourse.atprotocol.community/t/removing-the-member-list/895)), ZDS removed the protocol-level **member list** from permissioned spaces. Rationale: a space host already fully controls credential minting ("a space host *could* mint a credential for anyone, regardless of if they were on the space member list or not"), so the member list was a false constraint. Access is now decided **dynamically at credential-request time**, and reader/group semantics move **above** the protocol into the application layer (app-defined membership, optionally via community lexicons / federated credential decisions); private-space credentials are owner-only by default.

**what changed for plyr.fm** (PR #1574):
- **audit: we depend on none of the removed surface.** we never read `members`/`isMember` and never called a member-list route (`addMember`/`getMembers`/…); we use only retained substrate methods (`createSpace`, `create/putRecord`, `getBlob`, `getMemberGrant`/`getSpaceCredential`, `listSpaces`). nothing broke, and prod was unaffected (no prod PDS implements the surface).
- **docs/framing-only change**: reframed the already-enforced owner-only access as plyr's explicit **app-layer** policy (not a "single-member" protocol member list) in the playback proxy + `ensure_personal_space` + the design note. recorded that any broader access — label rosters, supporter tiers, shared catalogs — is future plyr **app-layer state** (records in the space), never a PDS member list.

**takeaway**: the bet is still experimental and the proposal is still moving. building thin against the *substrate* (credentials + records/blobs) rather than transient surface (member lists) is exactly what made this a one-PR docs adaptation instead of a rewrite.

#### production release `2026.0610.034454` — the accumulated stack shipped to prod (June 10)

**why**: everything from this arc (visibility refactor + private media + auth/upload resilience) had stacked on staging; released as one deliberate, vetted prod deploy after a backfill dry-run + a Neon restore-point branch.

**what shipped to prod**:
- the **visibility model** (single `Track.visibility` enum) + its migration. backfilled prod exactly as the pre-flight dry-run predicted — 884 public / 20 unlisted / 4 supporters / 0 private (of 908), `support_gate` retained, no reclassification.
- **auth/upload resilience now protects all prod users**: the redis distributed OAuth-refresh lock (#1565 — which fixed a *silent* R2-only blob fallback that had been dropping audio off users' PDSes), PAR retry (#1566), empty-OAuth-error surfacing (#1561), multi-refresh.
- **private media is live but inert on prod** — gated on a PDS implementing `com.atproto.space.*`, which no prod PDS does, so it degrades to exactly today's behavior by design.

**technical note / migration learning**: the deploy ran the visibility migration via fly `release_command`, which executes *before* the new machines finish rolling out. dropping a column (`unlisted`) that way caused **one** brief cutover error — an old machine (old code still `SELECT`ing `unlisted`) hit the new schema for a single in-flight request, then self-healed once the new code was fully up. for the next destructive (column-drop) migration, use **expand/contract**: ship schema-tolerant code first, drop the column in a *later* release. (the Neon restore-point branch made rollback a non-event; it wasn't needed.)

#### radio embed: station pinning + switching (PR #1571, issue #1570, June 9 — merged to main/staging, prod ships with the next frontend release)

**why**: the standalone `/embed/radio` widget was permanently tuned to the default station — it fetched `/radio/state` with no station param and rendered no switcher, so `?station=` on the iframe URL was silently ignored.

**what shipped**:
- the embed reuses the main radio page's `TunerDial` (it's self-contained), so visitors can flip stations inside the widget; `?station=` pins the initial station, and an unknown slug falls back to the server default instead of going "off air". station flips keep a tuned-in listener playing on the new station; the brand link follows the active station (an embed pinned to `fresh` clicks through to `/radio/fresh`). iframes sized for the pre-dial layout hide the dial row via a height media query instead of clipping.
- **intentional non-behaviors**: no localStorage persistence of the pick (third-party iframe storage is partitioned, and an embedder's `?station=` pin should stay authoritative on reload) and no iframe-URL rewriting on flip (it would fight the embedder's param).

#### lexicon documentation: prod permission set published with docs (PR #1569, June 9)

**why**: [lexicon garden](https://lexicon.garden/lexicon/did:plc:vs3hnzq2daqbszxlysywzy54/fm.plyr.authFullApp) renders developer docs from `description` fields in published schemas. our only published prod lexicon — the `fm.plyr.authFullApp` permission set — had only the OAuth consent-screen strings (`title`/`detail`), so its docs tab was empty. first step of documenting all our lexicons.

**what shipped**:
- `fm.plyr.authFullApp` republished to prod with a `description` (live on lexicon garden). it documents the **interface** — a stable `include:fm.plyr.authFullApp` scope request whose expansion is defined by the set — and deliberately does NOT enumerate the collections: the `permissions` array already declares those machine-readably, and prose would drift as the set evolves while defeating the indirection the set exists to provide.
- `scripts/publish_permission_set.py` now reads schemas from `lexicons/*.json` (the source of truth `docs/public/lexicons/overview.md` already declared) instead of duplicating defs inline, rewrites the `fm.plyr.` namespace recursively for staging, and requires naming sets explicitly — the old script unconditionally published both sets, which would have accidentally shipped the staging-only `fm.plyr.privateMedia` to prod.

**remaining**: the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) have `description`s in `lexicons/` but aren't published at all — publishing them plus a docs-quality pass on each is the next phase.

#### private media on permissioned spaces — EXPERIMENTAL, in prod but inert (PRs #1557→#1567, issue #1528, epic #1384, June 8–9)

> **⚠️ load-bearing caveat: this is built on an unfinished _proposal_, not a shipped standard.** the `com.atproto.space.*` permissioned-data surface exists only in Daniel Holmgren's permissioned-data diaries (a design still in flux) and in ZDS (`pds.zat.dev`) — the user's own reference PDS implementation. it is **not** in the reference PDS, only ZDS implements it, and the proposal is still changing — it already did once ([member list removed](https://discourse.atprotocol.community/t/removing-the-member-list/895), see the June 10 pivot entry above). the code shipped to prod on June 10, but it is **inert there** — no prod PDS implements the surface, so it activates only for ZDS accounts and degrades to today's behavior for everyone else. must not be presented as a stable feature. #1528 framed this explicitly as a *probe*; #1384 tracks adopting the substrate per-feature *when it ships*. we are deliberately out on a limb to de-risk early — expect to revise as the API firms up.

**why**: prove a minimum-viable private-media workflow on the experimental permissioned-data surface (#1528) — audio that lives in the artist's own permissioned space on their PDS (never plyr's R2), access-controlled, owner-only.

**what works end-to-end on staging** (each step verified against live ZDS via spans):
- **upload**: choosing "private" streams the audio blob straight to the user's PDS blobstore (`com.atproto.repo.uploadBlob`), never R2; the worker writes a `fm.plyr.track` record into the user's `fm.plyr.stg.privateMedia/self` space (`audio_storage='pds'`, no R2 copy).
- **visibility model**: a single `Track.visibility` enum (`public|unlisted|supporters|private`) replaced three overlapping booleans (#1557). private is excluded from every public surface (feed, top, for-you, discover, search, non-owner artist pages) and inert (no follower DM, embedding, copyright, or genre hooks).
- **capability + scope**: private is offered only when the PDS supports spaces, and the space scope (`include:<privateMedia>`) is requested **on demand** when a user picks private — never proactively, because a non-supporting PDS resolves the permission set and over-grants a meaningless scope (#1560). the scope-upgrade flow resumes the interrupted upload (#1563).
- **playback**: credential-gated proxy — `/audio/{id}` → `getMemberGrant` → `getSpaceCredential` → ranged `getBlob` (206), owner-only, credential cached across seek requests; non-owner/anon → 404.

**supporting resilience fixes (general, not space-specific — worth keeping regardless of the bet)**:
- PDS-blob upload survives concurrent token rotation (#1565): refresh on every 401 + a **redis distributed refresh lock** (`oauth_refresh:<session_id>`) replacing the in-process `asyncio.Lock` that couldn't coordinate across worker processes. this fixed a *silent* R2-only fallback that had been dropping audio blobs off users' PDSes (mostly post-March-6, when PDS-blob upload became default-on per #1060) — verify with the actual PDS record's `audioBlob`, not the DB flag.
- OAuth PAR retried on transient `ReadTimeout` (#1566); empty OAuth-start errors now surfaced with type + traceback (#1561); owner can open their own private track page (#1567 — the `/track/[id]` SSR load runs anonymously since the session cookie is API-host-scoped, so it now falls back to a client-authed fetch).

**ZDS-side fixes (the user's reference PDS, separate repo)**: permission-set `include:` OAuth resolution; PAR handled-errors (4xx instead of 500); and the refresh-token-lifetime bug — ZDS had been giving refresh tokens the access token's 1h expiry, so every session died ~1h after login until re-auth (broke uploads and private playback).

**remaining**: a production smoke-test harness (matrix of file types × visibilities, fully inert — no DM/listing/stats — run on each prod release); a comments-credentials nit (the track page's `loadComments` omits `credentials`, so an owner's own private-track comments 404); and an eventual deliberate prod release of the whole accumulated stack.

#### radio stations + tuner dial + diversity + per-user liked state (PRs #1530→#1548, prod June 5, release 2026.0605.172049 + frontend-only follow-ups)

**why**: radio launched as a single undifferentiated stream that one prolific artist (long DJ sets) dominated, with no way to pick a vibe. It also leaked tracks from deactivated accounts and AI "slop", was broken on mobile (reload loop, accidental station switches, cramped layout), and the like button never reflected what the signed-in listener had already liked.

**what shipped**:
- **station lineup** (`api/radio/`): the stream is now a set of distinct stations — `loved` (most-played, the default, back-compatible when `?station` is omitted), `fresh` (newest by rank-based recency), `deep-cuts` (underplayed back-catalog), and `slop` (AI/suno-tagged, reusing `DEFAULT_HIDDEN_TAGS`). Every non-slop station excludes slop; slop excludes the plyr.fm account's own tracks. Stations are bookmarkable at `/radio/<slug>`; the URL path is the source of truth.
- **diversity**: rank-decay weighting (`exp(-rank/RANK_DECAY)` over each station's lens ranking, not raw scores) bounds the tail so no single artist or catalog size swamps a station — replaced a naive airtime cap.
- **tuner dial** (#1539): replaced station tabs with a horizontal tuner dial + needle indicator; arrow keys and swipe flip stations (the swipe attachment bails on vertical-dominant / button-origin gestures).
- **per-user liked state** (#1546, #1548): `/radio/state` takes an optional session and returns `liked` per track via a single batch query (`get_user_liked_track_ids`); the page seeds `LikeButton` with it. Anonymous requests are unaffected. Like-from-radio works when signed in.
- **correctness**: deactivated atproto accounts are excluded from discovery (`Artist.deactivated`, persisted from `#account` firehose events + a backfill migration); long track titles clamp to two lines instead of blowing up the fixed-height layout.
- **mobile + layout polish**: fixed a reload loop (a `$effect` subscribing to `radio.state`; fixed with `untrack` + guard), accidental station switching, the header/tuner gap, and footer clipping. Artwork is now a contained square over a blurred ambient backdrop (no more weird wide-screen slice); the dial has a fixed width so it never resizes with the artwork; height-based media queries handle short/landscape viewports. The "inspired by radio.wisp.place / integration" credit moved onto the `live radio` header line, with integration opening as a right-anchored glass popover that doesn't reflow the page.

**technical notes / lessons**:
- **iOS autoplay across track boundaries**: `onEnded` must swap the audio `src` synchronously with no `await` in between, or iOS blocks `play()` and radio dies on every boundary. State advances optimistically; rotation refreshes in the background.
- **the liked-state bug was a missing `credentials: 'include'`** on the client `/radio/state` fetch — the HttpOnly session cookie never reached the backend, so `get_optional_session` was always `None`. The backend regression test overrode the session dependency directly, so it validated serialization but never cookie propagation and missed it. Authenticated fetches must send credentials.

### May 2026

See `.status_history/2026-05.md` for detailed history.

---

### April 2026

See `.status_history/2026-04.md` for detailed history.

---

### March 2026

See `.status_history/2026-03.md` for detailed history.

---

### February 2026

See `.status_history/2026-02.md` for detailed history.

---

### January 2026

See `.status_history/2026-01.md` for detailed history.

### December 2025

See `.status_history/2025-12.md` for detailed history.

### November 2025

See `.status_history/2025-11.md` for detailed history.

## priorities

### current focus

**private media on ATProto permissioned spaces — EXPERIMENTAL, in prod but inert** (#1557→#1567, issue #1528, epic #1384, June 8–9): the big arc of the window. private audio that lives in the artist's own permissioned space on their PDS (never plyr's R2), access-controlled, owner-only. End-to-end on staging: private upload streams the blob to the user's PDS blobstore, the track is hidden from every public surface, and playback is a credential-gated proxy (`getMemberGrant` → `getSpaceCredential` → ranged `getBlob`). **⚠️ load-bearing caveat**: built on the unfinished `com.atproto.space.*` *proposal* — only ZDS (`pds.zat.dev`) implements it, no prod PDS does, so it activates only for ZDS accounts and degrades to today's behavior for everyone else. The single `Track.visibility` enum (`public|unlisted|supporters|private`) that #1557 introduced replaced three overlapping booleans and shipped to prod for real. The space scope is requested **on demand** (only when a user picks private), never proactively — a non-supporting PDS would over-grant a meaningless scope otherwise.

**permissioned-data pivot — the member list was removed upstream** (#1573→#1574, June 10): ZDS dropped the protocol-level **member list** from permissioned spaces ([thread](https://discourse.atprotocol.community/t/removing-the-member-list/895)) — a space host already controls credential minting, so the list was a false constraint. Access is now decided dynamically at credential-request time; reader/group semantics move **above** the protocol into the app layer. We depend on **none** of the removed surface (we never read `members`/`isMember`, only the retained credential + record/blob substrate), so #1574 was a docs/framing-only change reframing our owner-only access as explicit plyr app-layer policy. The takeaway: building thin against the substrate rather than transient surface made an upstream breaking change a one-PR adaptation.

**June 10 prod release `2026.0610.034454`** — the accumulated stack shipped to prod after a backfill dry-run + a Neon restore-point branch. The visibility migration backfilled exactly as predicted (884 public / 20 unlisted / 4 supporters / 0 private of 908). Auth/upload resilience now protects all prod users: the redis distributed OAuth-refresh lock (#1565, which fixed a *silent* R2-only blob fallback that had been dropping audio off users' PDSes), PAR retry (#1566), empty-OAuth-error surfacing (#1561). **Migration learning**: dropping a column via fly `release_command` (runs before new machines roll out) caused one brief self-healing cutover error — use expand/contract (schema-tolerant code first, drop the column a release later) next time.

**lexicon documentation + radio embed station switching** (June 9): the prod `fm.plyr.authFullApp` permission set was republished with a developer-facing `description` (#1569) — now live on [lexicon garden](https://lexicon.garden/lexicon/did:plc:vs3hnzq2daqbszxlysywzy54/fm.plyr.authFullApp), documenting the *interface* rather than enumerating collections (which would drift). The publish script now reads `lexicons/*.json` and requires naming sets explicitly so the staging-only `privateMedia` set can't ship to prod by accident. Separately, the `/embed/radio` widget gained `?station=` pinning + an in-widget `TunerDial` (#1571) so embedders can flip stations — merged to staging, prod with the next frontend release.

**next**: **collection continuity (Part B of continuous playback)** — tapping a track *inside* a collection should queue the rest of it (today's row tap calls `playNow`, which drops the collection). The clean framing is to generalize the "next from" machinery we already shipped: the tapped collection becomes a labeled *playback context* ("next from: \<album/playlist\>") that plays after your explicit adds and falls through to For You when it ends. Held pending a design call on which surfaces count as ordered/queueable — albums & playlists are clear, artist catalogs (#1353) and feeds/search are fuzzier. publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
- private-media (staging-only): the track page's `loadComments` fetches without `credentials`, so an owner's comments on their *own* private track 404 (the track + audio + everything else work). trivial fix — send `credentials: 'include'`.
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- share to bluesky (#334)
- lyrics and annotations (#373)
- configurable rules engine for moderation (#958)
- infrastructure consolidation — audit and migrate from Fly.io sprawl to Helm/K8s pattern (#907, reference: `../relay`)
- time-release gating (#642)
- social activity feed (#971)

## technical state

### architecture

**backend**
- language: Python 3.11+
- framework: FastAPI with uvicorn
- database: Neon PostgreSQL (serverless)
- storage: Cloudflare R2 (S3-compatible, CDN via custom domains)
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
- ✅ audio streaming via 307 redirects to CDN (audio.plyr.fm, edge-cached)
- ✅ lossless audio (AIFF/FLAC) — AIFF uploads publish instantly as a 16-bit WAV compatibility rendition; the MP3 streaming rendition + PDS blob are produced by a deferred background task without blocking the upload
- ✅ PDS blob storage for audio (user data ownership)
- ✅ play count tracking, likes, queue management
- ✅ "keep playing" — opt-in continuous playback from the For You feed when the queue runs dry ("next from: for you")
- ✅ queue items with artwork thumbnails + right-side drag-to-reorder (desktop + touch)
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

- fly.io (backend + redis + transcoder + moderation): ~$24/month
- neon postgres: $5/month
- cloudflare (R2 + pages + domain): ~$1/month
- copyright scanning (AuDD): ~$5-10/month
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

see the [contributing guide](https://docs.plyr.fm/contributing/) for setup instructions, or install the [contribute skill](.claude/skills/contribute/SKILL.md) for AI coding assistants.

## documentation

- **public docs**: [docs.plyr.fm](https://docs.plyr.fm) — for listeners, artists, developers, and contributors
- **internal docs**: [docs/internal/](docs/internal/) — deployment, auth internals, runbooks, moderation
- **lexicons**: [docs.plyr.fm/lexicons/overview](https://docs.plyr.fm/lexicons/overview/) — ATProto record schemas

---

this is a living document. last updated 2026-06-10 (documented two June 10 events: (1) the **permissioned-data pivot** #1573→#1574 — ZDS removed the protocol-level member list from `com.atproto.space.*` per the upstream thread [removing the member list](https://discourse.atprotocol.community/t/removing-the-member-list/895); the credential is the substrate and reader/group access moves to the app layer. plyr depended on none of the removed surface, so #1574 was a docs/framing-only change reframing our owner-only access as explicit app-layer policy — the unfinished-proposal caveat made real; and (2) the **prod release `2026.0610.034454`** — the whole accumulated stack shipped to prod: the visibility migration backfilled exactly as the dry-run predicted (884/20/4/0 of 908), the auth/upload resilience fixes now protect all users, private media is live-but-inert (no prod PDS has the surface). migration learning: a destructive column-drop via fly `release_command` caused one self-healing cutover error — use expand/contract next time). previously 2026-06-09 (documented two June 9 items: the prod `fm.plyr.authFullApp` permission set republished with a developer-facing `description` #1569 — live on lexicon garden, documenting the interface rather than enumerating collections, with the publish script refactored to read `lexicons/*.json` and require naming sets explicitly so staging-only `privateMedia` can't ship to prod by accident; and the `/embed/radio` widget gaining `?station=` pinning + an in-widget `TunerDial` #1571, merged to staging, prod with the next frontend release). previously 2026-06-09 (documented the private-media-on-permissioned-spaces probe #1557→#1567, issue #1528, epic #1384: functionally complete end-to-end on **STAGING ONLY** (never released to prod) — private upload → audio blob on the user's own PDS (never R2) → hidden from every public surface → owner track page → credential-gated `getBlob` playback. **⚠️ load-bearing caveat: built on an unfinished _proposal_** (`com.atproto.space.*`; only ZDS/`pds.zat.dev` implements it; the design may change before it lands in the reference PDS) — experimental, deliberately out on a limb, NOT stable. Also general resilience fixes worth keeping regardless: a redis distributed OAuth-refresh lock that fixed a *silent* R2-only blob fallback dropping audio off users' PDSes #1565, OAuth PAR retry #1566, empty-OAuth-error surfacing #1561, owner-can't-open-own-private-track fix #1567; ZDS-side: refresh tokens no longer inherit the access token's 1h expiry). previously 2026-06-05 (documented the radio stations + tuner-dial cluster #1530→#1548 shipped to prod June 5: radio is now a lineup of distinct stations — loved/fresh/deep-cuts/slop — picked via a tuner dial, with rank-decay weighting for artist diversity, deactivated-account + slop exclusion, bookmarkable `/radio/<slug>`, per-user liked state, and a mobile/layout overhaul. Key lessons inline: iOS needs a synchronous `src` swap in `onEnded`, and authed fetches need `credentials: 'include'` — the liked-state bug was a cookie that never reached the backend, missed because the test stubbed the session dependency).
