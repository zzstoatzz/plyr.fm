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

#### adult-audio labels + sensitive-content policy (#1676, #1677, #1682, July 16–17)

**why**: explicit long-form audio reached fresh radio while the ATProto labeler
was still treated as a copyright-specific subsystem. Operators had no durable
adult-audio action, anonymous listeners had no protection at the byte endpoint,
and the existing sensitive-artwork setting did not cover audio.

**what shipped**: the moderation service now emits and queries generic signed
labels; global ATProto `sexual` and `porn` values map to a separate
`show_sensitive_audio` preference. Adult-labeled tracks are hidden by default
across discovery, search, collections, queues, recommendations, Subsonic, and
shared radio; audio bytes require an authenticated opt-in and fail closed when
label state cannot be checked. Artwork and audio remain independently
configurable under a visually distinct parent control with a mixed state.
Tracks 1177–1179 were labeled `sexual`; the temporary emergency `unlisted`
changes were fully restored, leaving labels as the durable policy mechanism.

creators can now add the same standard content notice during upload or editing.
Their ATProto self-label stays separate from signed operator provenance, while
the backend applies policy to the union and preserves the notice across every
first-party record rebuild. Existing PDS records have a dry-run-first
reconciliation path.

the first UX follow-up makes that provenance visible to creators when an
independent adult-audio label remains active, gives every portal edit field a
distinct control surface, fixes the empty copyright heading for users without
that feature, and adds a reproducible Storybook edit-state fixture to the
accessibility gate.

**operator lesson**: the incident exposed an access/runbook gap.
`MODERATION_AUTH_TOKEN` emits labels, while `MODERATION_BSKY_PASSWORD` only
updates the labeler account declaration; Neon label data lives in the separate
`plyr-moderation` project; and label writes require cache invalidation for
immediate effect. The public sensitive-content guide, operator runbook, and
agent access preflight now document those boundaries. First-class generic-label
operator tooling remains follow-up work.

#### repeat-one on the player (#1653, #1654, #1657, July 9 — frontend-only)

**why**: #1445 asked for loop + shuffle; the piece people actually reach for is "repeat this song". @AilaScott's #1518 implemented a spotify-style none/all/one cycle plus a shuffle button but went stale (five weeks behind the player rework) and its branch was entangled with an unrelated backend fix.

**what shipped**: her commit revived with authorship preserved (#1653), cut to an off/**one** toggle — no repeat-all (collection-level looping collides with the "next from" continuation design: when the queue drains, loop or fall through to For You? deliberately deferred rather than half-answered; the `RepeatMode` type leaves room for `'all'`), no shuffle button. `handleTrackEnded` short-circuits before the autoplay fast path (reseek + same-tick `play()`, preserving the ended-event playback grace); `repeat_mode` rides the queue state payload and round-trips across tabs like `shuffle`. two design iterations followed user review: the `<text>`-glyph "1" was off-center and oversized → lucide `repeat-1` stroke geometry at 18px (#1654); the queue-sidebar indicator first shipped as a clickable pill beside the inert source chip — two identical pills with different affordances — and moved to where it belonged: a toggle button beside shuffle in the queue-actions row, active-highlight as the state indicator (#1657). regression test mounts the real Player and dispatches `ended`.

#### collection continuity — Part B of continuous playback (#1626, #1627, #1632, July 2)

**why**: tapping a track *inside* an album/playlist called `playNow` and dropped the collection — Part B of the continuous-playback arc, previously held pending a design call.

**what shipped**: the tapped collection becomes a labeled playback context ("next from: \<album/playlist\>") that plays after explicit adds and falls through to For You when it ends — generalizing the shipped "next from" machinery (#1626). while reviewing it: auto-advance into a track whose audio can't load used to park the footer forever (gated and still-processing tracks skipped; genuine load failures had no handler) — the player now always skips to the next playable track (#1627). long "next from" labels truncate + long titles marquee (#1632).

#### subsonic-compatible surface at /rest (#1644–#1651, July 4–6)

**why**: @tynanpurdy asked whether plyr.fm speaks subsonic. a shim at `/rest` lets any off-the-shelf subsonic client (Symfonium, Amperfy, Shelv, Sonixd, ...) sign in with a plyr developer token and play your library.

**what shipped**: an isolated `backend/api/subsonic/` package — one `include_router` line touches existing code (#1644: ping/playlists/song/stream/coverArt). the rest was driven by watching real clients fail: Amperfy wanted album/artist browsing, genres, and `scrobble` (#1646 — subsonic listening now feeds `play_count`); song entries needed `albumId`/`artistId`/`parent` linkage (#1648); the OpenSubsonic envelope needed `serverVersion`/`openSubsonic` (#1649); Shelv's save button calls navidrome's *native* `POST /auth/login` (never touches `/rest` — invisible in subsonic telemetry) so a minimal navidrome-compat login route exists (#1650); shuffle needed `getRandomSongs`, and "most played" (`type=frequent`) was silently alphabetical — now real summed `play_count` ordering (#1651). the surface stays out of the OpenAPI schema (#1647), and the API root answers 200 for client reachability probes (#1645). **experimental**: dev token = subsonic password; expect gaps until more clients are exercised.

#### storybook: component isolation + enforced accessibility (#1634–#1642, July 3–4)

**why**: the copyright-popover bug (#1633) was exactly the class of thing a component-isolation harness would have caught before a user did — no way existed to poke at a component's states without deploying.

**what shipped**: storybook harness (#1634), published to Cloudflare Pages on every merge to main (#1636, #1638), first batch of stories (#1637), and a design-system docs surface — intro, foundations, theming, a11y (#1639). accessibility is now **enforced, not advisory**: every story renders in real Chromium and CI fails on axe violations (#1640); existing stories brought into WCAG contrast compliance (#1641). one structural fix fell out: the track row was a single `<button>` wrapping other links and buttons (invalid HTML, broken keyboard/screen-reader navigation) — interactive controls are no longer nested (#1642).

#### browserless dev-token minting + JIT CI tokens (#1629–#1631, July 2–3)

**why**: the red-since-June-4 staging integration suite — CI's long-lived `PLYR_TEST_TOKEN_*` rot into `SessionExpiredError` when their inline OAuth grant expires, and the only re-mint path was a browser consent flow.

**what shipped**: mint a dev token from an atproto **app-password**, no browser (#1629, `just mint-dev-token`); tier 1 of the token plan — CI mints a **1-day token per run and throws it away** (`POST /auth/dev-token/app-password`, doubly gated behind an env flag + admin token), so the only durable secret is an app-password per test account (#1630); app-password sessions carry full repo access and no OAuth scope string, so they bypass the scope-coverage gate rather than 403 (#1631). the mechanism is proven live; the integration workflow itself still needs to be wired to it (see known issues).

#### radio embed: keep playing across track boundaries (#1652, July 4)

**why**: reported by @graham.systems running `plyr.fm/embed/radio?autoplay=1` as an OBS browser source — the embed went silent after one track. browsers fire `pause` before `ended`; the embed's `onpause` set `playing = false`, which both the resume path and the 30s poll keyed off, so every boundary loaded the next track but never played it.

**what shipped**: a `tunedIn` flag tracking **listener intent**, separate from the raw element `playing` state — boundaries resume, the poll keeps syncing.

#### post-login intent preservation + listener/creator landing default (#1624, July 2)

**why**: signing in always dumped you on `/portal`, regardless of where you started. following a shared jam link while logged out meant sign in → portal → manually re-find the link. the `plyr_return_to` cookie mechanism (10-min TTL, relative-path-validated) was built for exactly this back when the jam share flow first exposed it, but capture only ever lived on the jam page — the login page parsed `?return_to=` for the back-arrow but never armed the cookie, and the backend callback hardcodes `/portal`. #1448 (May 26) generalized capture but went stale; this is that work rebased across five weeks of churn plus a new landing default.

**what shipped**: a `lib/utils/auth-redirect.ts` helper (`redirectToLogin(intent?)` stashes path+query+hash, `resolvePostLogin()` consumes it after the OAuth exchange, `loginHref(intent?)` for declarative links — all gated by the existing `isValidReturnPath`, relative-only, so it's open-redirect-safe). capture is now armed at **every** sign-in touchpoint: the login page (shared links work on their own now), header buttons, auth-guarded pages (`/settings`, `/portal`, `/profile/setup`), upload session-expiry paths, the track-page comment prompt, gated-track toasts, the liked empty-state CTA. **new behavior**: with *no* captured intent, the portal checks `GET /tracks/me?limit=1` — `total === 0` (a listener, no published tracks) lands on the app (`/`), a creator stays on the portal. scoped strictly to the just-signed-in arrival (exchange token present) and it **fails open** to today's portal-landing, so a deliberate `/portal` visit is never redirected. cookie not localStorage (the 10-min TTL means a stale intent can't teleport you somewhere surprising days later); the backend callback still lands on `/portal?exchange_token=…` as the exchange consumer and forwards from there. vitest coverage for the stash/consume round-trip, one-shot consumption, and the open-redirect guard — the tests didn't exist when #1448 was written.

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

See `.status_history/2026-06.md` for detailed history (firehose dead-audioUrl verification #1616; copyright flags no longer silently wiped #1615; status-recap transcript #1613; client-logo keyline #1608/#1609; CF Pages lockfile incident #1606/#1607; live-infra costs feed #1599 + jetstream identity propagation #1603/#1604; ALAC-in-m4a transcode + radio/embed autoplay hardening #1596/#1597/#1598; local-dev fresh-DB onboarding #1584–#1586 + collections/design-system refactor #1579–#1591; the permissioned-data member-list pivot #1573/#1574; the June 10 prod release `2026.0610.034454`; radio embed station switching #1571; lexicon docs #1569; the private-media probe #1557→#1567; and the radio-stations + tuner-dial cluster #1530→#1548).

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

**radio breadth + radio-as-a-real-listening-source** (#1620, #1622, July 1 — prod): the arc of the window. #1620 widened rotation reach (per-station rank decay, 4h reseeding, a per-station exploration floor) — `loved`/`deep-cuts` went from 8% to ~55% of the catalog aired over 14 simulated days while `loved` keeps 86% of its airtime on ever-liked tracks. #1622 then made signed-in radio listening actually *count*: it had never fired `POST /tracks/{id}/play` (radio's direct `src` swap bypassed the queue loader that arms play counting), so it never counted plays or dispatched teal scrobbles — fixed frontend-only, verified end-to-end via teal `feed.play` records landing on a listener's PDS. **consequence**: radio plays now feed `play_count`, so they feed the `loved`/`deep-cuts` lens inputs — #1620's exploration floor bounds the feedback loop; play-source attribution (so `loved` doesn't self-reinforce from radio) is deferred.

**post-login intent preservation** (#1624, July 2): signing in returns you to wherever you were (a shared jam link, a gated track, a settings deep-link) instead of always dumping you on `/portal`; a `lib/utils/auth-redirect.ts` helper arms the `plyr_return_to` cookie (10-min TTL, relative-only, open-redirect-safe) at every sign-in touchpoint. New landing default: with no captured intent, a listener (no published tracks) lands on the app, a creator stays on the portal — scoped to the just-signed-in arrival, fails open to portal-landing. Revives the stale #1448.

**still experimental — private media on permissioned spaces** (#1557→#1574, epic #1384): the June arc. private audio in the artist's own permissioned space on their PDS (never R2), owner-only, credential-gated playback — end-to-end on staging, **in prod but inert** (only ZDS implements the unfinished `com.atproto.space.*` proposal, no prod PDS does). ZDS then dropped the protocol-level member list (#1573/#1574); we depend on none of the removed surface, so it was a docs-only adaptation. See `.status_history/2026-06.md`.

**subsonic surface** (#1644–#1651, July 4–6): an experimental `/rest` shim so off-the-shelf subsonic clients (Symfonium, Amperfy, Shelv, ...) play plyr libraries with a developer token as the password. built client-by-client against real failures; expect gaps until more clients are exercised. **collection continuity shipped** (#1626, July 2): tapping a track inside an album/playlist now queues the rest as a labeled "next from" context — Part B of continuous playback, previously held pending the queueable-surfaces design call (albums & playlists in; artist catalogs #1353 and feeds/search still open). **repeat-one shipped** (#1653/#1654/#1657, July 9), reviving @AilaScott's #1518; repeat-all deliberately deferred until the loop-vs-continuation interaction is designed.

**next**: wire the integration-tests workflow to JIT token minting (#1630 built the mechanism; the suite is still red). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
- **staging integration suite still red** (since ~June 4, last green May 14): the original cause — expired OAuth sessions behind `PLYR_TEST_TOKEN_{1,2,3}` — now has a designed fix (JIT per-run token minting from app-passwords, #1629/#1630), but the workflow hasn't been wired to it; the latest runs (July 6) fail differently (exit 127, command not found), so the wiring work includes diagnosing the current script failure.
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
- ✅ repeat-one on the player + queue sidebar toggle
- ✅ experimental subsonic-compatible surface at `/rest` (developer token as password)
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

this is a living document. last updated 2026-07-16 (documented the sensitive-audio response, labeler rollout, affected tracks 1177–1179, and the access/operator-tooling gaps). previously 2026-07-09 (documented the July 2–9 window: **repeat-one** #1653/#1654/#1657 — @AilaScott's #1518 revived with authorship preserved, cut to an off/one toggle, two design iterations on the icon and the queue-sidebar placement; **collection continuity** #1626 + skip-on-load-failure #1627; the **subsonic `/rest` surface** #1644–#1651 built client-by-client (Amperfy, Shelv) with navidrome-native login compat; **storybook + enforced axe a11y gate** #1634–#1642 including the track-row nested-controls fix; **browserless/JIT dev-token minting** #1629–#1631; the **radio embed boundary fix** #1652. known issues: integration suite entry updated — JIT mechanism exists, workflow wiring remains, current failure mode is exit 127). previously 2026-07-02 (archived the whole **June 2026** section to `.status_history/2026-06.md` now that it's a prior month; documented **post-login intent preservation** #1624 — signing in now returns you to wherever you were via the `plyr_return_to` cookie armed at every sign-in touchpoint, with a new listener/creator no-intent landing default, reviving the stale #1448). previously 2026-07-01 (documented the radio arc: **rotation breadth** #1620 — per-station rank decay, 4h reseeding, and a per-station exploration floor took `loved`/`deep-cuts` from 8% to ~55% of the catalog aired over 14 days while keeping 86% of `loved`'s airtime on ever-liked tracks, shipped in release `2026.0701.205443`; **radio play counts + teal scrobbles** #1622 — signed-in radio listening had never fired `POST /tracks/{id}/play` (radio's direct `src` swap bypassed the queue loader that arms play counting), so it never counted plays or scrobbled; fixed frontend-only, verified end-to-end via teal play records on a listener's PDS. also backfilled June 29–30: **copyright flags no longer silently wiped** #1615 (sync now clears only on explicit negation — flagging had been non-functional since #703) and **ingest dead-audioUrl verification** #1616 + its retrospective docs #1619. known issues: added the red-since-June-4 staging integration suite (expired `PLYR_TEST_TOKEN_*` sessions) and the track-1045 307 loop; removed the fixed copyright-wipe entry). previously 2026-06-26 (**status-recap audio now carries its own transcript** #1613 — the status-maintenance action renders a podcast transcript to audio and uploads it as a plyr.fm track, but discarded the transcript; it's now attached as the track's `--description`, carried between the two workflow phases as a `status-audio-<branch>` build artifact instead of being committed to the repo). previously 2026-06-25 (backfilled ~2 weeks of work spanning three tagged prod releases plus two frontend-only releases: **client logos** went transparent with a WCAG-1.4.11 contrast keyline #1608/#1609 (frontend-only, June 25); a **CF Pages lockfile incident** #1606/#1607 had broken every frontend deploy — fixed by committing the text `bun.lock` and deleting both the binary `bun.lockb` and a stale `package-lock.json`; release `2026.0620.184443` brought the **live-infra costs feed** #1599 (~$20→~$68/mo real) and **jetstream identity propagation** #1603/#1604 (handle renames had never propagated — `#identity` events carry no handle, so resolution moved to microcosm slingshot + a dedicated process group); release `2026.0614.214124` brought **ALAC-in-m4a transcode detection** #1598 and **radio/embed autoplay hardening** #1596/#1597; release `2026.0611.221739` brought **local-dev fresh-DB onboarding fixes** #1584/#1585/#1586 (async alembic + `just db-init` + driverless-URL coercion), the **collections/design-system refactor** #1579–#1591 (groundwork for epic #1578), and **embeds always-blur sensitive artwork** #1577. updated known issues (copyright-flag wipe #1602, costs CF $0 gap) and the cost structure to ~$68/mo). previously 2026-06-10 (documented two June 10 events: (1) the **permissioned-data pivot** #1573→#1574 — ZDS removed the protocol-level member list from `com.atproto.space.*` per the upstream thread [removing the member list](https://discourse.atprotocol.community/t/removing-the-member-list/895); the credential is the substrate and reader/group access moves to the app layer. plyr depended on none of the removed surface, so #1574 was a docs/framing-only change reframing our owner-only access as explicit app-layer policy — the unfinished-proposal caveat made real; and (2) the **prod release `2026.0610.034454`** — the whole accumulated stack shipped to prod: the visibility migration backfilled exactly as the dry-run predicted (884/20/4/0 of 908), the auth/upload resilience fixes now protect all users, private media is live-but-inert (no prod PDS has the surface). migration learning: a destructive column-drop via fly `release_command` caused one self-healing cutover error — use expand/contract next time). earlier June entries (lexicon docs #1569, radio embed station switching #1571, the private-media probe #1557→#1567, and the radio-stations + tuner-dial cluster #1530→#1548) are detailed in `.status_history/2026-06.md`.
