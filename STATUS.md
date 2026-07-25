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

#### the moderation event log, and decisions in public (#1699–#1706, July 25 — releases `2026.0725.061813`, `.064312`, `.065535`)

**why**: #1697 made labels do something, which exposed what was underneath them.
There was no way to say "the match is real, it's a cover, surface it anyway" —
the only lever against a false positive was negating the label, i.e. claiming
the assertion was wrong. Worse, the moderation dashboard could not see its own
work: its queue read *labels*, but post-#703 a scan never emits one, so
thirteen flagged tracks and the platform's first real user report sat behind a
queue that rendered **0**.

**what shipped**:
- `moderation_events` in the moderation service — append-only, one table
  covering the review queue, per-track overrides, the audit trail, and a
  proposed-action object for future automation (#1699).
- scan flags and user reports now open review items (#1700, #1702). Reports
  needed fixing in two places — the service recorded no event *and* the backend
  never sent `target_uri`, so the log had nothing to key on. Either alone was a
  no-op.
- `tracks.moderation_override` (`allow` / `exclude`) projected alongside labels
  and honoured by `discovery_visible_clause` (#1700).
- the dashboard's primary tab reads `/admin/queue`, embeds
  `plyr.fm/embed/track/{id}` so a copyright call is made by *listening*, and
  requires an "acting as" handle on every decision (#1701).
- moderation decisions publish from
  [@moderation.plyr.fm](https://bsky.app/profile/moderation.plyr.fm) (#1703–#1705).
- the 13 pre-existing flags were backfilled into the queue. Nobody was notified.

**technical notes**:
- **the override is the point.** Negating a label says the assertion was wrong;
  `override_allow` says it was right and we are surfacing the track anyway.
  Different statements. `allow` deliberately does *not* override the adult half
  — that is a listener preference, and an operator deciding what someone else
  may be *shown* is a different power from deciding what we *host*.
- **emitting a label neither opens nor closes review.** Asserting something is
  not the same as being finished with it; collapsing the two is how an empty
  queue came to mean "no work".
- **publish actions taken, never suspicions held.** Flags and reports are never
  posted — announcing a flag is the "knowledge without action" of the
  2026-01-02 review, and announcing a report would make the report button a way
  to publicly stain a rival. Posts never name an uploader.
- **the publisher cannot backfill**: its cursor initialises at the log's head,
  so the 17 events predating it were never narrated. It is enabled on
  `relay-api` only — staging shares the Bluesky account. When disabled it still
  logs rendered posts, which is how it was verified before going live.
- **attribution is not authentication.** `actor` is required on every write, but
  the service still trusts one shared key, so the log records a *claim*. Real
  per-actor auth is what actually gates letting an agent act rather than
  propose.

**bugs found by shipping it**: the `moderation_override` column is null for
nearly every track and `NOT (NULL = 'exclude')` is NULL, which a WHERE clause
drops — the first cut hid the entire catalogue (caught by 12 failing tests).
Autogenerated migration proposed dropping the `api_keys` and
`pending_account_creations` tables plus four trigram indexes, from local dev
drift; hand-written instead. Transparency posts shipped with a 404 policy link,
then with **no link facets at all** — Bluesky does not infer links from text, so
both URLs rendered as unclickable grey text. The disabled-but-logging mode
caught the first; you caught the second.

#### labels that act: copyright enforcement + adult sharing (#1697, July 25)

**why**: user report #5 — the first genuine user report on the platform —
flagged track 64 as containing copyrighted material heard on a live stream.
Rescanning flagged it (249 matches, `highest_score = 0`: #1689's mix detection
working correctly, since no single song dominates a mix). Then nothing
happened, because `copyright-violation` did not do anything. Investigating
found the inverse problem next to it: adult labels blocked audio *bytes* for
anonymous listeners, so a creator could not share their own labeled track with
anyone signed out.

**what shipped**:
- `copyright-violation` is projected onto `tracks.operator_labels` and excluded
  from radio, feeds, search, and collections — for everyone, with no preference
  and no owner exemption on shared surfaces. Creators still see and manage
  their own flagged tracks; `list_my_tracks` filters on `artist_did` alone.
- adult labels no longer gate audio bytes. Permalinks play for everyone; what a
  listener is *shown* is still theirs to control.
- `discovery_visible_clause()` composes both families so a caller cannot apply
  one and not the other.
- the ten pre-#703 public copyright labels were retracted (seq 728–737).
- policy written up in `docs/internal/moderation/label-policy.md`.

**technical notes**:
- **the model**: a label is a *portable assertion* — signed, public, and free
  for any client to interpret. Enforcement is *plyr-local hosting policy* keyed
  off that assertion, binding on nobody else. Conflating the two is what let
  "we labeled it" and "we did something about it" both be true and unrelated.
- **the two families differ in who decides.** Adult is a rendering default a
  listener may override for themselves. Copyright is a hosting obligation — we
  serve the bytes, so the duty to act on knowledge is ours and no listener
  preference discharges it.
- **neither gates bytes.** The adult gate looked like age verification and was
  not: any account satisfied it, and plyr verifies nobody's age. Copyright does
  not gate bytes either, because a fingerprint match is not a finding — several
  flagged tracks read as covers or remixes the uploader performed. De-listing
  is reversible; a dead permalink is not. Removing the gate also deleted a
  strict labeler read, and its 503 failure mode, from every audio request.
- **a composition bug was caught on the way**: the old call site skipped the
  whole visibility predicate for viewers who opted into sensitive audio, so
  folding copyright into it without composing would have leaked copyright
  tracks to exactly those viewers. Regression test pins it.
- **#1695 re-justified**: it invalidated the redis label cache, but the SQL
  filters read the projection, not that cache — so once bytes stopped being
  gated it would have been dead weight. It now refreshes the projection, so a
  copyright label de-lists in seconds instead of on the 5-minute sync.

**the history, because it explains the shape**: this was not drift. The
2026-01-02 legal review concluded that public "potential violation" labels we
have not acted on create knowledge without action — *"either don't flag it, or
flag it and act on it."* `df0c0dae` (#703) did the first half and deferred the
second "for future use when we build the notification + action pipeline." That
pipeline was never built, and ten already-published labels were never
retracted, so the exact configuration the review warned about stayed publicly
queryable for roughly seven months. Adult enforcement was built separately in
July (#1676–#1683) during a live incident, end to end, because it had to work
that day. Two systems built under opposite pressures, reconciled here.

**deliberately not done**: no uploader notification — pointing a new
notification pipeline at a backlog would DM people about December flags, so any
notification must fire on new events only. No per-track override yet (see
known issues). Not adopting Ozone: Acorn's moderation is a customized Ozone
fork, but Ozone wants to own the labeler DID we already run, adds a VPS and
Postgres, and its UI targets Bluesky posts rather than audio — borrowing its
event-log model instead.

#### moderation service boundary + a fail-open label cache (#1691–#1695, July 24–25 — release `2026.0725.035625`)

**why**: the moderation service's `/admin/*` prefix mixed two unrelated
consumers behind one auth middleware — the htmx dashboard a human opens, and
the hot-path endpoints the backend calls for audio authorization and label
projection. "admin" reads as human-only, and there was no structural boundary
between a dashboard page and an API the byte endpoint depends on.

**what shipped**: the six service-to-service endpoints moved to `/internal/*`
(#1692), served from one route table nested at both prefixes so the deprecated
`/admin/*` aliases cannot drift; the backend then swapped its four label reads
over (#1693). The aliases stay until the next release, then come out. The
operator surface — `/admin/flags`, `/admin/resolve`, `/admin/batches`,
`/admin/context` — deliberately stayed put, so the moderation scripts were
untouched; that was verified against the deployed service rather than assumed.
The three scripts then collapsed onto one shared client (#1694, −146/+25).

**the thing worth remembering**: verifying the rename end-to-end on staging —
upload a track, emit a real signed `sexual` label, watch the backend react —
surfaced a fail-open window that had nothing to do with the rename. The label
cache is keyed by **subject URI and is viewer-independent**, so a single
playback by anyone caches "no labels" for everyone. `emit_label` invalidates on
the way out, but that only covers labels *the backend* emitted; operators emit
through the dashboard, a script, or curl, straight to the labeler. So a track
labeled while its cache entry was warm kept serving audio to anonymous
listeners for the full 300s TTL — on the one endpoint explicitly designed to
fail closed. A `subscribeLabels` consumer now invalidates each subject as the
labeler commits it (#1695), measured on staging at **0.8s instead of ~300s**.
It reads the stream rather than having the labeler call back, which keeps the
dependency pointing one way — load-bearing here, because a single labeler
serves both the staging and production backends. It runs in the existing
`jetstream` process group; no new infrastructure. Partially addresses #1678.

**deferred**: the `operator_labels` projection still syncs on its own ~5-minute
interval (measured at 301s), so recovery after a negation is bounded by that
sync, not by the subscriber — worth having the stream nudge the projection for
the affected subject. Removing the `/admin/*` aliases is a follow-up now that
prod is on `/internal`.

**operator lesson**: `POST /admin/batches` treats an empty `uris` list as
"every pending flag". Probing it with `{}` created a real 10-flag review batch
in the production moderation DB (removed; the shared client now rejects an
empty list).

#### at-tags meta + copyright mix detection (#1689, #1690, July 23–24)

track, album, playlist, and artist pages emit at-tags meta (#1690). Copyright
scanning now flags mixes of copyrighted songs rather than only single-song rips
(#1689) — a sustained-match count threshold, so a DJ mix stitched from several
commercial tracks no longer slips through a per-song score gate.

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

**moderation: from inert labels to recorded decisions** (#1697–#1706, July 25): the arc of the window. `copyright-violation` de-lists instead of doing nothing; adult labels stopped gating permalinks; and underneath both, `moderation_events` now carries the review queue, per-track overrides, the audit trail, and the source of public transparency posts from @moderation.plyr.fm. The dashboard finally shows the work it exists to show — it had been reading labels, so scan flags were structurally invisible. **next in this arc**: triage the 13 queued tracks; per-actor authentication, which is what gates agent participation; then a proposed/applied split so an agent can propose a decision a human approves.

**moderation: labels that act** (#1697, July 25): `copyright-violation` now de-lists a track from radio and discovery instead of being inert, closing the "act on it" half of the 2026-01-02 legal review that #703 deferred and nobody returned to; adult labels stopped gating audio bytes, so a creator's permalink works for signed-out listeners again. The organizing idea is that **a label is a portable assertion and enforcement is local hosting policy** — adult defers to the listener, copyright cannot, because we serve the bytes. (superseded by the entry above — the event log, overrides, and transparency all shipped the same day.)

**moderation service boundary + label-cache correctness** (#1691–#1695, July 24–25 — prod `2026.0725.035625`): the labeler's service-to-service endpoints now live under `/internal/*`, structurally separate from the `/admin/*` moderator dashboard, with aliases retained for one deploy cycle. Verifying that rename end-to-end turned up the more important bug: the label cache is keyed by subject URI and viewer-independent, so any playback cached "no labels" for everyone and an operator-emitted label had no effect on audio byte authorization for up to 300s — fail-open on the endpoint designed to fail closed. A `subscribeLabels` subscriber closes it to ~0.8s. **next in this arc**: drop the `/admin/*` aliases; have the stream nudge the `operator_labels` projection so negations recover in seconds rather than on the 5-minute sync.

**radio breadth + radio-as-a-real-listening-source** (#1620, #1622, July 1 — prod): the arc of the window. #1620 widened rotation reach (per-station rank decay, 4h reseeding, a per-station exploration floor) — `loved`/`deep-cuts` went from 8% to ~55% of the catalog aired over 14 simulated days while `loved` keeps 86% of its airtime on ever-liked tracks. #1622 then made signed-in radio listening actually *count*: it had never fired `POST /tracks/{id}/play` (radio's direct `src` swap bypassed the queue loader that arms play counting), so it never counted plays or dispatched teal scrobbles — fixed frontend-only, verified end-to-end via teal `feed.play` records landing on a listener's PDS. **consequence**: radio plays now feed `play_count`, so they feed the `loved`/`deep-cuts` lens inputs — #1620's exploration floor bounds the feedback loop; play-source attribution (so `loved` doesn't self-reinforce from radio) is deferred.

**post-login intent preservation** (#1624, July 2): signing in returns you to wherever you were (a shared jam link, a gated track, a settings deep-link) instead of always dumping you on `/portal`; a `lib/utils/auth-redirect.ts` helper arms the `plyr_return_to` cookie (10-min TTL, relative-only, open-redirect-safe) at every sign-in touchpoint. New landing default: with no captured intent, a listener (no published tracks) lands on the app, a creator stays on the portal — scoped to the just-signed-in arrival, fails open to portal-landing. Revives the stale #1448.

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, epic #1384): private audio in an artist-owned permissioned space (never R2), owner-only, credential-gated playback — end-to-end on staging, **in prod but inert** (only ZDS implements this experimental surface). The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md` and `.status_history/2026-06.md`.

**subsonic surface** (#1644–#1651, July 4–6): an experimental `/rest` shim so off-the-shelf subsonic clients (Symfonium, Amperfy, Shelv, ...) play plyr libraries with a developer token as the password. built client-by-client against real failures; expect gaps until more clients are exercised. **collection continuity shipped** (#1626, July 2): tapping a track inside an album/playlist now queues the rest as a labeled "next from" context — Part B of continuous playback, previously held pending the queueable-surfaces design call (albums & playlists in; artist catalogs #1353 and feeds/search still open). **repeat-one shipped** (#1653/#1654/#1657, July 9), reviving @AilaScott's #1518; repeat-all deliberately deferred until the loop-vs-continuation interaction is designed.

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); wire the integration-tests workflow to JIT token minting (#1630 built the mechanism; the suite is still red). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
- **13 tracks await triage in the review queue**, including track 64 (user report #5 from @vicwalker.dev.br). They are visible and playable in the dashboard now; nobody has made a call on any of them. A fingerprint match is not a finding — several read as covers or remixes the uploader performed.
- **no per-actor authentication**: the moderation service trusts one shared `MODERATION_AUTH_TOKEN`, so the event log's `actor` is a claim rather than a verified identity. This is the gate on letting an agent *act* rather than propose, and on review genuinely not always being one person.
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

this is a living document. last updated 2026-07-25 (**the moderation event log** #1699–#1706 — `moderation_events` now carries the review queue, per-track overrides, the audit trail, and public transparency posts from @moderation.plyr.fm; the dashboard reads the queue instead of labels, embeds the track so a copyright call is made by listening, and attributes every decision; the 13 pre-existing flags were backfilled with nobody notified. Also a full documentation pass: the public sensitive-content guide had been telling listeners that adult audio cannot be played by anonymous listeners, which #1697 made false, and a new public moderation policy page now backs the link in every transparency post. New known issues: 13 tracks await triage, and per-actor authentication is the gate on agent participation). previously 2026-07-25 (**labels that act** #1697 — `copyright-violation` now de-lists from radio and discovery instead of doing nothing, and adult labels stopped gating audio bytes so creators' permalinks work for signed-out listeners; the organizing idea is that a label is a portable assertion while enforcement is local hosting policy, which is why adult defers to the listener and copyright cannot. Retracted the ten pre-#703 public labels. Traced the asymmetry to the 2026-01-02 legal review, whose "flag it and act on it" half was deferred in #703 and never built. New known issues: no per-track override, and three flagged-but-unlabeled tracks needing triage). previously 2026-07-25 (documented the July 23–25 window and the `2026.0725.035625` prod release: the **moderation service boundary** #1691–#1694 — service-to-service endpoints moved to `/internal/*` with `/admin/*` aliases for one deploy cycle, the operator surface deliberately left in place, and the three moderation scripts collapsed onto one shared client; the **fail-open label cache** #1695 — found while verifying the rename end-to-end on staging, a URI-keyed viewer-independent cache meant an operator-emitted label had no effect on audio byte authorization for up to 300s, now closed to ~0.8s by a `subscribeLabels` subscriber; plus **at-tags meta** #1690 and **copyright mix detection** #1689. New known issue: negation recovery still waits on the ~5-minute `operator_labels` projection sync). previously 2026-07-20 (aligned private media with ATProto permissioned-data Proposal 0016: canonical addresses, space-type/permission-set separation, client attestations, host resolution, and sync read foundations; #1684). previously 2026-07-16 (documented the sensitive-audio response, labeler rollout, affected tracks 1177–1179, and the access/operator-tooling gaps). previously 2026-07-09 (documented the July 2–9 window: **repeat-one** #1653/#1654/#1657 — @AilaScott's #1518 revived with authorship preserved, cut to an off/one toggle, two design iterations on the icon and the queue-sidebar placement; **collection continuity** #1626 + skip-on-load-failure #1627; the **subsonic `/rest` surface** #1644–#1651 built client-by-client (Amperfy, Shelv) with navidrome-native login compat; **storybook + enforced axe a11y gate** #1634–#1642 including the track-row nested-controls fix; **browserless/JIT dev-token minting** #1629–#1631; the **radio embed boundary fix** #1652. known issues: integration suite entry updated — JIT mechanism exists, workflow wiring remains, current failure mode is exit 127). previously 2026-07-02 (archived the whole **June 2026** section to `.status_history/2026-06.md` now that it's a prior month; documented **post-login intent preservation** #1624 — signing in now returns you to wherever you were via the `plyr_return_to` cookie armed at every sign-in touchpoint, with a new listener/creator no-intent landing default, reviving the stale #1448). previously 2026-07-01 (documented the radio arc: **rotation breadth** #1620 — per-station rank decay, 4h reseeding, and a per-station exploration floor took `loved`/`deep-cuts` from 8% to ~55% of the catalog aired over 14 days while keeping 86% of `loved`'s airtime on ever-liked tracks, shipped in release `2026.0701.205443`; **radio play counts + teal scrobbles** #1622 — signed-in radio listening had never fired `POST /tracks/{id}/play` (radio's direct `src` swap bypassed the queue loader that arms play counting), so it never counted plays or scrobbled; fixed frontend-only, verified end-to-end via teal play records on a listener's PDS. also backfilled June 29–30: **copyright flags no longer silently wiped** #1615 (sync now clears only on explicit negation — flagging had been non-functional since #703) and **ingest dead-audioUrl verification** #1616 + its retrospective docs #1619. known issues: added the red-since-June-4 staging integration suite (expired `PLYR_TEST_TOKEN_*` sessions) and the track-1045 307 loop; removed the fixed copyright-wipe entry). previously 2026-06-26 (**status-recap audio now carries its own transcript** #1613 — the status-maintenance action renders a podcast transcript to audio and uploads it as a plyr.fm track, but discarded the transcript; it's now attached as the track's `--description`, carried between the two workflow phases as a `status-audio-<branch>` build artifact instead of being committed to the repo). previously 2026-06-25 (backfilled ~2 weeks of work spanning three tagged prod releases plus two frontend-only releases: **client logos** went transparent with a WCAG-1.4.11 contrast keyline #1608/#1609 (frontend-only, June 25); a **CF Pages lockfile incident** #1606/#1607 had broken every frontend deploy — fixed by committing the text `bun.lock` and deleting both the binary `bun.lockb` and a stale `package-lock.json`; release `2026.0620.184443` brought the **live-infra costs feed** #1599 (~$20→~$68/mo real) and **jetstream identity propagation** #1603/#1604 (handle renames had never propagated — `#identity` events carry no handle, so resolution moved to microcosm slingshot + a dedicated process group); release `2026.0614.214124` brought **ALAC-in-m4a transcode detection** #1598 and **radio/embed autoplay hardening** #1596/#1597; release `2026.0611.221739` brought **local-dev fresh-DB onboarding fixes** #1584/#1585/#1586 (async alembic + `just db-init` + driverless-URL coercion), the **collections/design-system refactor** #1579–#1591 (groundwork for epic #1578), and **embeds always-blur sensitive artwork** #1577. updated known issues (copyright-flag wipe #1602, costs CF $0 gap) and the cost structure to ~$68/mo). previously 2026-06-10 (documented two June 10 events: (1) the **permissioned-data pivot** #1573→#1574 — ZDS removed the protocol-level member list from `com.atproto.space.*` per the upstream thread [removing the member list](https://discourse.atprotocol.community/t/removing-the-member-list/895); the credential is the substrate and reader/group access moves to the app layer. plyr depended on none of the removed surface, so #1574 was a docs/framing-only change reframing our owner-only access as explicit app-layer policy — the unfinished-proposal caveat made real; and (2) the **prod release `2026.0610.034454`** — the whole accumulated stack shipped to prod: the visibility migration backfilled exactly as the dry-run predicted (884/20/4/0 of 908), the auth/upload resilience fixes now protect all users, private media is live-but-inert (no prod PDS has the surface). migration learning: a destructive column-drop via fly `release_command` caused one self-healing cutover error — use expand/contract next time). earlier June entries (lexicon docs #1569, radio embed station switching #1571, the private-media probe #1557→#1567, and the radio-stations + tuner-dial cluster #1530→#1548) are detailed in `.status_history/2026-06.md`.
