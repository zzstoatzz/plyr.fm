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

### July 2026

#### radio play counts + teal scrobbles (#1622, July 1 — frontend-only release)

**why**: a listener (streaming plyr radio on stream.place) reported no teal scrobbles despite having the pref enabled and the teal OAuth scopes granted. diagnosis: signed-in radio listening had **never** produced scrobbles — or play counts — since radio became a player mode (May 30/31, where this was noted as deferred). scrobbles dispatch from exactly one place, `POST /tracks/{id}/play` (fired by the frontend after min(30s, 50% of duration) of *listened* time), and radio mode never called it: radio swaps `audio.src` directly (required for iOS autoplay across track boundaries), bypassing the queue-track loader whose `loadeddata` listener is the only thing that armed play counting — and the counter targeted `player.currentTrack`, which radio nulls. telemetry confirmed the reporter had zero `/play` calls in 14 days of active listening while queue listeners scrobbled normally all month.

**what shipped**: `incrementPlayCount` targets `radio?.track ?? currentTrack` (one mechanism for both sources — same threshold, endpoint, and server-side dedup), and `playRadio` arms the counter (`resetPlayCount()` before the src swap so a stale near-end position can't fire, then `unlockPlayCount()`). verified on staging (anonymous radio session fired `/play` after ~30s) then released frontend-only; verified on prod end-to-end — five `fm.teal.alpha.feed.play` records landed on a listening user's PDS during a radio session. **consequence worth knowing**: radio listening now feeds `play_count` for the first time, so it feeds the `loved`/`deep-cuts` lens inputs (#1620's exploration floor bounds the feedback loop). regression tests in `player-radio.test.ts` prove the threshold fires for the on-air track and re-arms across boundaries (verified failing against the pre-fix player).

#### radio rotation breadth: per-station decay, 4h reseeding, exploration floor (#1620, July 1 — release `2026.0701.205443`)

**why**: user reports that radio felt repetitive. the corpus wasn't the problem (918 eligible tracks, ~117h across 71 artists) — the sampler's reach was. simulating the exact production sampler against the prod corpus: consecutive-day rotations overlapped **81%**, and over 14 days only **8% of the catalog ever aired** (nothing past lens-rank ~85). three compounding mechanisms: a global `RANK_DECAY=12` concentrated all weight in the top ~36 ranks; the ranking barely moves day to day (likes/plays are nearly static); and the daily seed meant a listener with a fixed listening window heard the same slice of the same 4h loop every day.

**what shipped**:
- **per-station rank decay**: `rank_decay` moved onto `Station`. `loved`/`fresh`/`slop` keep 12 (a tight head is their identity); `deep-cuts` gets 48 — its lens scores are near-ties across hundreds of underplayed tracks, so a tight head froze one arbitrary slice into rotation, defeating the station's purpose.
- **4-hour reseeding**: rotations reseed per `epoch // 4h` instead of per calendar day (still stateless + deterministic — every client computes the identical rotation within a period).
- **exploration floor**: each draw has a per-station probability (default 0.25) of picking uniformly from the un-drawn pool instead of lens-weighted, so the dormant tail (376 mature tracks with ≤2 plays) actually cycles through. **`fresh` gets 0.0** — its identity is the leading edge, and a uniform draw would leak arbitrarily old tracks into "the newest uploads" (the exact regression rank-decay weighting was built to prevent; the first cut had this bug and the per-station breadth check caught it).

**measured effect** (real prod corpus, 14 simulated days, exact production code): `loved` 8%→55% of the catalog aired, `deep-cuts` 8%→56% (overlap 82%→11%), `fresh` ~unchanged by design (its turnover is bounded by the ~10–20 uploads/week, not the sampler). `loved` keeps its character: 86% of airtime stays on ever-liked tracks (19% of the corpus), zero-signal tracks get 2%.

**deferred**: anti-repeat memory across periods (needs replaying prior seeds); play-source attribution so `loved` doesn't self-reinforce from radio plays (now that radio plays count — see #1622 above).

### June 2026

#### firehose ingest: dead-audioUrl verification (#1616, June 30) + copyright flags no longer silently wiped (#1615, June 29)

**#1616**: a firehose-ingested `fm.plyr.track` record can claim an `audioUrl` on plyr's own CDN for an object plyr never stored (foreign client computing our content-addressed URL, or an interrupted write). origin trust checked that the URL *names* our CDN, not that the bytes exist, so rows landed as `audio_storage='both'` with an `r2_url` that 404s forever on playback despite a usable `audioBlob` in the same record. the create-from-scratch ingest branch now HEADs the object after the origin check and falls back to the PDS blob when absent. the incident also produced three internal docs (#1619): the `GET /audio` dispatch tree, the jetstream-ingest trust model, and the recovery runbook.

**#1615** (fixes #1602): `sync_copyright_resolutions` cleared `is_flagged` for any URI absent from the labeler's *active*-label set — but since #703 disabled auto-labeling, a flag emits no label at all, so absence is the normal state of a real flag and the 5-minute sync wiped every flag within minutes. copyright flagging had been effectively non-functional in prod since. the labeler now exposes explicitly-negated URIs (`/admin/negated-labels`) and the sync clears a flag only on explicit negation; a labeler outage now resolves nothing instead of everything.

#### status-recap audio now carries its own transcript (#1613, June 26 — tooling)

**why**: the status-maintenance action already generates a podcast transcript, renders it to audio, and uploads that audio as a track on plyr.fm — but the transcript itself was thrown away, so the recap track shipped with no description.

**what shipped**: the transcript is attached as the uploaded track's **description**. The wrinkle is that the two halves run as separate workflow runs — `workflow_dispatch` opens the PR (phase 1), `pull_request: closed` does the upload (phase 2) — so phase 2 only sees what phase 1 leaves behind. Rather than commit the audio/transcript to the repo (as `update.wav` used to be), both now ride between phases as a **build artifact** named `status-audio-<branch>`; nothing lands in the repo. The artifact name has to encode the PR branch claude creates mid-run, because phase 1 is dispatched on `main` and its own run-level branch/sha point at `main` — the branch name is the only durable join back to the merge run. Phase 2 looks the artifact up by name, downloads it from its owning run, and passes the transcript through `--description` (added an `actions: read` permission for the lookup). Pinned `plyrfm >=0.0.1a21`, the first SDK release exposing `--description`. Both files are now gitignored; if audio was skipped and no artifact exists, phase 2 logs and exits cleanly, as before.

#### client logos: transparent marks with a contrast keyline (#1608, #1609, June 25 — frontend-only prod release)

**why**: the "open links in" client picker (and the links-menu profile card) flattened each external client logo onto an opaque white tile so dark marks stayed legible. the white box looked bad in both themes and clipped at the rounded corners.

**what shipped (prod)**: a shared `ClientLogo.svelte` renders each mark transparent and traces it with a thin theme-aware **keyline** — four `0.5px` zero-blur drop-shadows at half opacity (light on dark, dark on light). this clears the **WCAG 1.4.11 non-text contrast** bar (3:1) for graphical objects — the standard the white tile was crudely approximating — without recoloring or distorting the marks. first cut (#1608) used a *blurred* halo; it glowed into the negative space of fine marks (blacksky's starburst) and read like defacing the branding, so #1609 swapped the blur for the crisp keyline. validated all five marks (bluesky/blacksky/witchsky/red dwarf/pdsls) against the live icon URLs in both themes. broad app-wide contrast tokenization deliberately deferred — this fixes the one surface where intrinsic-color logos meet the theme background.

#### CF Pages frontend deploys were broken by a stale/binary lockfile (#1606, #1607, June 22)

**why**: **every** prod/staging frontend deploy was failing, regardless of the change. two causes stacked: (1) a 7-month-stale `package-lock.json` (Nov 2025) sat alongside `bun.lockb`, making CF's package-manager detection ambiguous; and (2) CF's bundled bun (1.2.15) is older than local and **cannot parse our binary `bun.lockb`** (`failed to parse lockfile … Ignoring lockfile`), after which it resolves every dep fresh-to-latest-in-range (svelte 5.42.3→5.56.3, vite 7.1.12→7.3.5 + transitive drift). that drift breaks svelte's TS preprocessing, so `<script lang="ts">` files fail to parse (`event?: PointerEvent` → "Expected ','").

**what shipped**: removed the stale `package-lock.json` (#1606), then migrated the binary `bun.lockb` → the **text `bun.lock`** format (`bun install --save-text-lockfile`), preserving the exact working resolutions (#1607). verified against CF's exact bun 1.2.15 on a clean clone: it reads `bun.lock`, installs the pinned tree, builds clean. **rule**: commit text `bun.lock` only — never binary `bun.lockb`, never `package-lock.json`. diagnosed via the cloudflare-api MCP deployment logs (CF Pages builds produce no GitHub Actions run).

#### costs page pulls live infra spend; jetstream identity propagation (release `2026.0620.184443`, June 20)

**costs (#1599)**: `/costs` was fed by a `FIXED_COSTS` table last touched 2025-12-26 — it advertised ~$20/mo against a real **~$68/mo** (Fly hardcoded at $11.66, omitting both redis apps; Neon flat $5). `export_costs.py` now stops owning dollar figures: it fetches Fly/Neon/Cloudflare from the **hub.waow.tech** aggregator filtered to `project=="plyr.fm"` line items (the service→project map lives upstream in my-prefect-server), keeps AuDD computed from our own DB, and sums `monthly_estimate` with no constants to drift. `COSTS.md` is the human audit behind the feed. Also recorded the moderation Neon endpoint fix (was pinned always-on 1 CU → autoscale 0.25–1 CU + scale-to-zero, killing ~720 always-on CU-h/mo). **Known upstream gap**: Cloudflare isn't yet tagged `project=="plyr.fm"`, so the page shows CF $0 until that mapping is fixed.

**jetstream identity (#1603, #1604)**: a user who renamed their atproto handle kept the **old** handle on their public `/u/<handle>` profile while the portal showed the new one (tangled issue #5). root cause: jetstream `#identity` events carry **no handle** — the payload is just `{did, seq, time}` — but the consumer gated dispatch on `identity.handle` being truthy, so `ingest_identity_update` had **never** run for anyone (0 dispatches in 2 weeks of telemetry). fix: dispatch identity events on `did in known_dids` alone, then resolve the current verified handle+PDS from **microcosm slingshot** (`resolveMiniDoc`, bidirectionally verified) rather than trusting the event. the consumer also moved to its **own fly process group** (it had been starving as a docket task in the `worker` loop); a follow-up (#1604) sized that VM at 1gb after 512mb OOM-looped (the docket client imports the whole backend ~400MB RSS) and mirrored the process group into staging, which had been silently not ingesting. **Note**: #1604's durable fly.toml memory landed on staging + was applied live to prod via `fly scale memory`; the released fly.toml durability rides the next full `just release`. Embed now shows the artist **display name** not the handle (#1600).

#### ALAC-in-m4a uploads + radio/embed autoplay hardening (release `2026.0614.214124`, June 14)

**ALAC upload (#1598, fixes #1595)**: an `.m4a` extension was assumed web-playable, but **ALAC-in-m4a has no browser decoder** — chromium fires `MEDIA_ERR_SRC_NOT_SUPPORTED` and the track served raw/unplayable (it also stalled the deep-cuts radio station when such a track hit the on-air slot). the HTTP handler now inspects the m4a codec via mutagen and sets `needs_transcode` for ALAC, so the deferred `optimize_track_audio` task produces the MP3 streaming rendition. AAC-in-m4a (the common case) is unaffected. A companion script is deliberately **audit-only** (`audit_alac_m4a.py`) — an earlier draft that rewrote existing tracks' PDS records via a stored owner session was pulled, since holding a session is not consent to mutate a user's records.

**radio (#1596, #1597)**: a blocked `play()` during `?autoplay=1` left the UI lying (radio page showed "stop", footer showed LIVE, nothing playing) because `playRadio` set `player.radio` before `play()` and the catch only rolled back `paused` — a `NotAllowedError` on a *fresh* tune-in now rolls back radio mode entirely. radio `stream_url` is also built from the configured base instead of the request scheme (#1597).

#### local-dev onboarding fixes + collections/design-system refactor (release `2026.0611.221739`, June 11)

**fresh-DB / local setup (#1584, #1585, #1586)**: two contributor-reported setup failures. (1) a standard `postgresql://` URL crashed the backend because `create_async_engine` resolves it to sync psycopg2 — `DatabaseSettings` now coerces `postgresql://`/`postgres://` → `postgresql+psycopg://` (the prod driver; also handles `channel_binding`, which asyncpg can't), leaving explicit `+driver` URLs untouched so CI's `+asyncpg` path is unchanged. (2) `alembic upgrade head` against a fresh DB raised `MissingGreenlet` and could never have bootstrapped an empty database (alembic was adopted after the schema existed) — `env.py` moved to the async template, and new `just db-init` (`scripts/init_db.py`) creates the schema from models + stamps alembic head, refusing to run if `alembic_version` already exists. Plus onboarding-doc fixes (`backend/.env` location, removed `STORAGE_BACKEND=filesystem`, public-https-tunnel requirement) (#1601, June 20).

**collections / design-system (#1579, #1581, #1582, #1583, #1591)**: groundwork for the design-system cleanup epic (#1578) — extracted the playlist/album routes' API calls into `$lib/{playlist,album}-actions`, shared one drag-to-reorder module and the play/queue helpers + `ConfirmDialog` across both collection pages, and decomposed the playlist route into presentation components (documented as the pattern for the sibling audits #1587–#1590).

**embed autoplay + sensitive artwork (#1592, #1593, #1577)**: the radio embed honors `?autoplay=1` (with documented embed params); embeds — unauthenticated contexts where the viewer's sensitive-artwork preference is unknowable — now **always blur** flagged artwork (`SensitiveImage` gained a `respectPreference` prop, default true; embeds pass false), with the first frontend component tests (vitest) covering it.

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
- **staging integration suite has been red since ~June 4** (last green May 14): every run fails with `SessionExpiredError` — the OAuth sessions behind the `PLYR_TEST_TOKEN_{1,2,3}` CI secrets expired. it's a `workflow_run` job on main so it blocks nothing and nobody noticed. needs the three staging test accounts re-authenticated and fresh developer tokens minted into the secrets; why the sessions expired (~around the #1565 refresh-lock release) is undiagnosed.
- track 1045 ("Vibe Check OST") serves a 307 loop instead of audio bytes on its CDN URL — possibly a #1368-style orphaned R2 reference; found by probing every track in the live radio rotation.
- `/costs` shows Cloudflare at $0 — upstream gap: CF line items aren't yet tagged `project=="plyr.fm"` in my-prefect-server, so the live feed can't attribute them (#1599).
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

current monthly costs: ~$68/month (plyr.fm specific) — the live `/costs` feed is the source of truth (#1599); the breakdown below is indicative, not hardcoded. `COSTS.md` is the human-readable audit.

see live dashboard: [plyr.fm/costs](https://plyr.fm/costs)

- fly.io (backend + redis ×2 + transcoder + moderation): the largest line; the prior ~$24 figure omitted both redis apps
- neon postgres: ~$5/month (moderation endpoint now autoscales 0.25–1 CU + scale-to-zero, was pinned always-on 1 CU)
- cloudflare (R2 + pages + domain): live feed reads $0 until CF is tagged `project=="plyr.fm"` upstream
- copyright scanning (AuDD): ~$5-10/month (computed from our own DB)
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

this is a living document. last updated 2026-07-01 (documented the radio arc: **rotation breadth** #1620 — per-station rank decay, 4h reseeding, and a per-station exploration floor took `loved`/`deep-cuts` from 8% to ~55% of the catalog aired over 14 days while keeping 86% of `loved`'s airtime on ever-liked tracks, shipped in release `2026.0701.205443`; **radio play counts + teal scrobbles** #1622 — signed-in radio listening had never fired `POST /tracks/{id}/play` (radio's direct `src` swap bypassed the queue loader that arms play counting), so it never counted plays or scrobbled; fixed frontend-only, verified end-to-end via teal play records on a listener's PDS. also backfilled June 29–30: **copyright flags no longer silently wiped** #1615 (sync now clears only on explicit negation — flagging had been non-functional since #703) and **ingest dead-audioUrl verification** #1616 + its retrospective docs #1619. known issues: added the red-since-June-4 staging integration suite (expired `PLYR_TEST_TOKEN_*` sessions) and the track-1045 307 loop; removed the fixed copyright-wipe entry). previously 2026-06-26 (**status-recap audio now carries its own transcript** #1613 — the status-maintenance action renders a podcast transcript to audio and uploads it as a plyr.fm track, but discarded the transcript; it's now attached as the track's `--description`, carried between the two workflow phases as a `status-audio-<branch>` build artifact instead of being committed to the repo). previously 2026-06-25 (backfilled ~2 weeks of work spanning three tagged prod releases plus two frontend-only releases: **client logos** went transparent with a WCAG-1.4.11 contrast keyline #1608/#1609 (frontend-only, June 25); a **CF Pages lockfile incident** #1606/#1607 had broken every frontend deploy — fixed by committing the text `bun.lock` and deleting both the binary `bun.lockb` and a stale `package-lock.json`; release `2026.0620.184443` brought the **live-infra costs feed** #1599 (~$20→~$68/mo real) and **jetstream identity propagation** #1603/#1604 (handle renames had never propagated — `#identity` events carry no handle, so resolution moved to microcosm slingshot + a dedicated process group); release `2026.0614.214124` brought **ALAC-in-m4a transcode detection** #1598 and **radio/embed autoplay hardening** #1596/#1597; release `2026.0611.221739` brought **local-dev fresh-DB onboarding fixes** #1584/#1585/#1586 (async alembic + `just db-init` + driverless-URL coercion), the **collections/design-system refactor** #1579–#1591 (groundwork for epic #1578), and **embeds always-blur sensitive artwork** #1577. updated known issues (copyright-flag wipe #1602, costs CF $0 gap) and the cost structure to ~$68/mo). previously 2026-06-10 (documented two June 10 events: (1) the **permissioned-data pivot** #1573→#1574 — ZDS removed the protocol-level member list from `com.atproto.space.*` per the upstream thread [removing the member list](https://discourse.atprotocol.community/t/removing-the-member-list/895); the credential is the substrate and reader/group access moves to the app layer. plyr depended on none of the removed surface, so #1574 was a docs/framing-only change reframing our owner-only access as explicit app-layer policy — the unfinished-proposal caveat made real; and (2) the **prod release `2026.0610.034454`** — the whole accumulated stack shipped to prod: the visibility migration backfilled exactly as the dry-run predicted (884/20/4/0 of 908), the auth/upload resilience fixes now protect all users, private media is live-but-inert (no prod PDS has the surface). migration learning: a destructive column-drop via fly `release_command` caused one self-healing cutover error — use expand/contract next time). previously 2026-06-09 (documented two June 9 items: the prod `fm.plyr.authFullApp` permission set republished with a developer-facing `description` #1569 — live on lexicon garden, documenting the interface rather than enumerating collections, with the publish script refactored to read `lexicons/*.json` and require naming sets explicitly so staging-only `privateMedia` can't ship to prod by accident; and the `/embed/radio` widget gaining `?station=` pinning + an in-widget `TunerDial` #1571, merged to staging, prod with the next frontend release). previously 2026-06-09 (documented the private-media-on-permissioned-spaces probe #1557→#1567, issue #1528, epic #1384: functionally complete end-to-end on **STAGING ONLY** (never released to prod) — private upload → audio blob on the user's own PDS (never R2) → hidden from every public surface → owner track page → credential-gated `getBlob` playback. **⚠️ load-bearing caveat: built on an unfinished _proposal_** (`com.atproto.space.*`; only ZDS/`pds.zat.dev` implements it; the design may change before it lands in the reference PDS) — experimental, deliberately out on a limb, NOT stable. Also general resilience fixes worth keeping regardless: a redis distributed OAuth-refresh lock that fixed a *silent* R2-only blob fallback dropping audio off users' PDSes #1565, OAuth PAR retry #1566, empty-OAuth-error surfacing #1561, owner-can't-open-own-private-track fix #1567; ZDS-side: refresh tokens no longer inherit the access token's 1h expiry). previously 2026-06-05 (documented the radio stations + tuner-dial cluster #1530→#1548 shipped to prod June 5: radio is now a lineup of distinct stations — loved/fresh/deep-cuts/slop — picked via a tuner dial, with rank-decay weighting for artist diversity, deactivated-account + slop exclusion, bookmarkable `/radio/<slug>`, per-user liked state, and a mobile/layout overhaul. Key lessons inline: iOS needs a synchronous `src` swap in `onEnded`, and authed fetches need `credentials: 'include'` — the liked-state bug was a cookie that never reached the backend, missed because the test stubbed the session dependency).
