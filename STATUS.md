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

### August 2026

#### private memos from /record never reached consent; browser e2e for private media (#1887–#1889, August 21 — prod frontend)

**why**: #1882's private option on `/record` was dead for every first-time
user: `stashRecording()` handed IndexedDB the `$state` proxy behind `tags`,
structured clone refused it (`DataCloneError`), and the page fell back to
the preview with "couldn't save your recording". Nothing caught it because
the live integration test signs in with an app password, and
`session_has_private_media_access()` short-circuits for those sessions —
capability detection, consent, and the granted token were structurally
untested.

**what shipped**:
- `frontend/e2e/private-media.mjs` and `frontend/e2e/record-private.mjs`:
  Playwright drives stg.plyr.fm with the zat test account through real OAuth
  (PAR → zds consent → callback), a private upload, the consent round trip,
  and playback from a fresh session; the record flow uses Chromium's fake
  microphone and asserts title + private visibility survive the stash.
  shared plumbing in `e2e/lib.mjs`. runs on every merge to main, on PRs that
  touch `frontend/e2e/**`, and via `workflow_dispatch`; on failure it prints
  the browser's API requests and console errors and uploads screenshots.
- `/record` stashes `$state.snapshot(tags)` and restores the chosen private
  visibility on the way back (it fell back to public before).
- eslint has a node-globals block for `e2e/**/*.mjs` (#1887 merged with
  pre-commit red on this).

**verification**: the record flow failed at `[consent]` against the
pre-fix staging build with the exact `DataCloneError`, then passed on main
after the Pages deploy: `[restored]` → private track → `206` from the space
proxy → cleanup. prod verified by the served `/record` chunk matching the
fixed build.

**open**: the first main run of the upload flow timed out at its second
sign-in with zero requests reaching staging from the fresh context; three
later runs passed and the cause is unknown. the diagnostics exist for the
next occurrence — don't call it flaky.

#### the createSpace body drifted from the spaces-alpha lexicons (#1876–#1878, August 21 — prod `2026.0821.071650`, `.073416`)

**why**: zds aligned with the published spaces-alpha lexicons on August 20
(zds `d68e94d`, atproto `2f77206`) and rejected the pre-alpha
`com.atproto.simplespace.createSpace` body plyr still sent — `did` plus a
`config` wrapper with a string `policy` — with `400 Missing policy`. every
first private upload from a pds.zat.dev account failed at space creation. same
drift class as #1656; reported by the zds side.

**what shipped**:
- `ensure_personal_space` sends the alpha body: `{type, skey: "self", policy:
  {$type: …#memberListPolicy}, appAccess: {$type: …#open}}`, anchored on the
  authenticated DID. zds authorizes the authority on its own member-list space
  without an explicit `addMember`, so owner-only stays zero-config. the unit
  test pins the exact payload and the absence of `did`/`config`.
- `list_space_repos` / `list_space_repo_ops` accept `cursor` (`since` is
  optional): a full page carries `cursor`, the head page carries the signed
  `commit` and no cursor. neither function assumed `commit` before, but neither
  could page.
- the #1856 rollout bridge — retry a `401 AuthenticationRequired` with a Bearer
  credential for the pre-DPoP zds — is deleted (#1878). a 401 on a space read
  now only renews the credential.
- `docs/internal/architecture/permissioned-private-media.md` names the contract:
  the `permissioned-data` branch-tip lexicons, with
  [Bulletin](https://github.com/bluesky-social/bulletin) as the reference
  client.

**verification**: old vs new body sent directly to pds.zat.dev on a fresh skey
(`400` vs `200`, `getSpace` echoes the unions); `scripts/permissioned_smoke.py`
green; the PR's CI ran the live private-media integration — real upload →
proxied playback → delete against zds — with and without the bridge. no user
impact: production has zero private tracks, staging's two belong to the test
account.

**technical notes**: reading Bulletin's whole atproto layer for the comparison
settled where plyr stands. the request/response surface plyr uses — space
creation, the delegation-token → DPoP-bound credential exchange, record writes,
`getBlob` — matches the reference client. the gap is architectural: Bulletin
is a *syncing service* (durable replica, `listRepoOps` to the `commit` then
`verifyCommit` against the writer's DID key and an LtHash state check, `getRepo`
CAR for initial sync, `registerNotify`/`notifyWrite`, and a `managingAppPolicy`
whose `checkUserAccess` callback it serves); plyr is a *proxying client* with no
replica, using `memberListPolicy` with nobody added. that is a product choice
for owner-only media, not drift — but `lib/sync/engine.ts` is the template if
#1684 ever needs a verified replica.

#### comment timestamps seek on the first click (#1873, August 17 — prod frontend)

**why**: a long-standing unreported irritation of nate's: clicking a comment's
timestamp on a not-yet-playing track started the track at 0; only a second
click landed on the timestamp.

**what shipped**: `seekToTimestamp` used to start the track and then check
`audioElement.readyState` — but the player attaches the new source
*asynchronously* (`resolveAudioSource`), so `readyState` still described the
previous source: the seek fired against the old audio and the new load reset
to 0. the click now sets `player.pendingSeek = { trackId, ms }`, applied by
the loader's `loadeddata` handler once the *matching* track's audio is
attached — taking precedence over the saved-progress restore, which was a
second, latent overwrite on the old fallback path. a pending seek for a
different track is cleared before load; a denied gated track clears it too.
regression tests mount the real `Player.svelte` and were proven failing with
the loader half reverted. verified on staging and prod by clicking real
comment timestamps cold (landed at 24.7s and 38.9s, not 0).

**also**: a new root-CLAUDE.md rule from the same session — no paragraph
comments in code; rationale lives here, in docs, commits, and PR bodies.

#### the iOS lock-screen scrub investigation, unwound to its last verified point (#1860–#1869, August 15–16; open as #1870)

**why**: on physical iPhones the Now Playing card shows correct metadata but
the scrubber cannot be grabbed at all — while SoundCloud's web player scrubs
fine in the same Safari, so it's achievable and it's our bug.

**what shipped**: #1860 is the keeper — ⏮/⏭ arrows restored (registering
`seekbackward`/`seekforward` makes iOS replace track-skip with 10s-skip
buttons; removed), prev/next (de)registered reactively so the OS knows when
they're live, `setPositionState` guarded against `Infinity`/`NaN` durations,
radio mode finally feeding the media session, plus settings-popover and
track-page fold fixes. everything after it — the "let iOS drive it natively"
theory (#1861), a bisect diagnostic page (#1862–#1867), guarded and then
throttled position state (#1865, #1868) — produced no observable improvement
on a physical phone and was reverted byte-for-byte to the #1860 state
(#1869). five recipe variants failed identically on-device; codec/range
support, artwork MIME, and call churn are all ruled out. the simulator bisect
shows a minimal page scrubbing fine until action handlers are added. #1870
holds the full matrix; the deciding experiment — a minimal page on a
*physical* phone, or Web Inspector attached to the device — hasn't run yet.

#### teal scrobbles write the production lexicons (#1823, August 16 — prod `2026.0816.012308`)

new writes use `fm.teal.feed.play` / `fm.teal.actor.status` (canonical after
teal-fm/teal#110) with the canonical URI field names; existing alpha records
are not rewritten, and collection names stay configurable via `TEAL_*` env
vars. authored by Codex, reviewed and landed here.

#### slugs transliterate instead of deleting (#1858, August 14 — prod `2026.0814.213524`)

`slugify()` dropped non-ASCII letters outright, so **tūnņg** slugged to `tng`
and the obvious `/album/tunng` URL 404'd (and 500'd through the frontend,
which rendered a thrown bare `Error`). NFKD-normalize + ASCII-fold now runs
before the character filter (`tūnņg` → `tunng`); a backend 404 surfaces as a
proper 404 page; and a conflict-guarded backfill re-derived the 9 affected
prod albums — only where the stored slug equals what the old pipeline
produced, so artist-chosen custom slugs were untouched. no redirects from the
old mangled forms: they were never shared as canonical links.

#### space credentials are DPoP-bound (#1856, August 14 — prod `2026.0814.200348`)

permissioned-space credentials now bind to an independent ephemeral DPoP key,
with operation-specific proofs on credential reads including ranged blob
playback, and the credential cache keyed by resident DID and space. a narrow
rollout bridge retries only exact `401 AuthenticationRequired` responses from
the current pre-DPoP ZDS — it never downgrades proof or policy errors.
verified against live ZDS via the private-media integration suite.

#### comments became a non-modal panel, and the track page finished its redesign (#1843–#1855, August 14 — prod `2026.0814.183107` + frontend releases)

**why**: comments lived inline at the bottom of the track page — invisible,
and any overlay treatment would have interrupted playback. nate wanted them
present but never modal, plus a round of review notes on the redesigned page.

**what shipped**:
- **comments are a docked panel, not a modal** (#1845–#1850): extracted into
  `TrackComments.svelte`, triggered from a count chip in the utilities row.
  the desktop treatment came from reading leaflet.pub's drawer source: a
  sibling column — no backdrop, no dim, no focus trap, page fully
  interactive. plyr's version docks 380px at the right edge; mobile docks
  above the footer player with the grab handle and swipe-to-dismiss. comments
  and the queue are sibling panels (#1849).
- **timestamp emissions** (#1851, #1855) — the soundcloud move: when playback
  crosses a comment's timestamp, the comment emanates from the 💬 trigger as
  a small glass bubble that lingers 4s and opens the panel on tap. seeks past
  a 3s window don't spray missed comments; untimed 0:00 comments never fire.
  per-comment "share" was removed (it copied a page-level link the page
  already owns).
- **the count flash was two bugs, not a style problem** (#1853): the
  single-track endpoints never gathered comment counts, so every detail
  response carried `comment_count: 0` — the optimistic trigger was an honest
  render of wrong data; and the component reset on the `track` prop's object
  identity, which the page reassigns after mount, so the whole thread
  refetched. count joins the gather; the effect keys on the id value.
- **like whimsy** (#1848): count pops on 0→1, digits roll on increment, the
  heart plays one heartbeat on like — all explicitly zeroed under
  `prefers-reduced-motion`, which svelte transitions don't respect natively.
- layout rounds: viewport-scaled vertical rhythm (#1844), centered
  composition with artwork absorbing spare height (#1854).

#### artists choose a download policy: open / ask / supporters / off (#1841 → #1842, August 14 — prod `2026.0814.051956`)

**why**: #1824's boolean opt-out was the v1 of a relationship dial nate
wanted now: downloads as a moment to route listeners toward supporting the
artist, without ever locking public bytes.

**what shipped**: `download_policy` replaces `allow_downloads` (`false→'off'`,
`true→NULL`). the default **auto** resolves to `ask` when the artist has a
support link and `open` otherwise. `ask` always downloads but shows one
interstitial first — "*artist* asks listeners to consider supporting their
work" with an accent link to their support page and a quiet continue: a
request, never a lock. `supporters` requires a verified support relationship
(signed-out 401, non-supporter 403 with `X-Support-Required`); non-supporters
simply never see the button. the control lives in the portal's profile
section beside the support-link selector, replacing the `/settings` row.

**technical notes**: verifier-neutral by construction — the schema stores
only the policy, and `download_refusal()` receives `viewer_is_supporter` as a
fact without learning how it was established, so the attested.network
entitlement path (#1871) swaps the resolution without touching schema or
endpoints. one policy function still feeds the track endpoint, the album-zip
endpoint, and `TrackResponse.downloadable`. supporters-tier bytes stay in the
public bucket deliberately: those tracks still stream publicly, so the gate
is an offer, the same exposure class as `r2_url` itself.

#### August 3 – 14 (archived)

See `.status_history/2026-08.md` for detailed history:

- **downloads grew from a flag into a policy** — track downloads for public,
  ungated, unflagged audio and the detail page redrawn to nate's sketch
  (#1824–#1826), albums as worker-built cached zips (#1836), and the
  `toast-copy` skill that fixed their progress copy (#1837–#1839).
- **an album batch wedged the app VM** (#1831, #1832) — aioboto3's reader-side
  `io_queue` eagerly buffers ~800MB of parts per upload by default on a 1GB
  machine; retro in
  [`docs/internal/runbooks/2026-08-14-upload-memory-wedge.md`](docs/internal/runbooks/2026-08-14-upload-memory-wedge.md).
- **the media hosts never had a CORS policy at all** (#1821), which is also why
  the artwork accent wash was inert in production (#1753).
- **a track row's `file_id` is not a storage key** (#1805–#1811) — eight sites
  keyed storage off an author-supplied field, including track and account
  deletion, which silently orphaned the real object; plus the portal's
  PDS-save honesty pass and the failure reasons behind it.
- **the credential chain, closed one step at a time** (#1778–#1790) — the
  session cache was writing decrypted OAuth tokens *and the DPoP private key*
  into an unauthenticated Redis; `/rest` accepted any browser session; the
  copyright vendors were pointed at an uploader-controlled `getBlob` URL.
- **exclude is curation, not removal** (#1797, #1799); the write-echo alert's
  first true positive and its recovery gap (#1796); search ranking lexical
  intent above trigram fuzz (#1801); `community.lexicon.app.profile` (#1817);
  the test-bootstrap and `just backend test` divergences (#1809, #1818).
- **earlier August**: redis grew a password (#1786) and a redis blip took the
  whole API down (#1787); the blackout alert that finally pages someone
  (#1775); `/atlas`, the 2D semantic map of the catalog (#1766–#1768); the
  legal codification that public audio is analyzed (#1769); embeds surviving
  sandboxed iframes (#1770); three player bugs with one disease (#1757–#1762).

### November 2025 – July 2026

See `.status_history/` for detailed history, one file per month: `2026-07.md`,
`2026-06.md`, `2026-05.md`, `2026-04.md`, `2026-03.md`, `2026-02.md`,
`2026-01.md`, `2025-12.md`, `2025-11.md`.

## priorities

### current focus

**downloads are a relationship dial, and the track page is a composition** (#1824–#1858, August 13–14 — prod `2026.0813.195021` → `2026.0814.213524`): five days took downloads from "does not exist" to a four-value per-artist policy (open / ask / supporters / off, defaulting to `ask` when the artist has a support link), covering single tracks and whole albums as worker-built cached zips, through one `download_refusal`/`download_key` pair that three endpoints and the UI's `downloadable` flag all derive from — so the button can never offer what the endpoint would refuse. The surface it landed on was redrawn in the same arc: one controls line, comments as a non-modal docked panel with timestamp emissions, mobile controls at the 44px floor. **next in this arc**: the attested.network entitlement path (#1871) swapping in behind `viewer_is_supporter`, which the schema was deliberately kept ignorant of; per-track toggles and download counts; elevation tokens done holistically rather than as a one-page snowflake (#1835).

**the iOS lock-screen scrubber is the standing unknown** (#1860–#1870, August 15–16): ⏮/⏭ arrows, metadata, and times all work on a physical iPhone; the scrubber cannot be grabbed under any of five media-session recipes, while SoundCloud's web player scrubs in the same Safari. Everything after #1860 was reverted byte-for-byte because none of it changed on-device behavior — codec/range support, artwork MIME, and call churn are ruled out, and the simulator disagrees with the phone. **next in this arc**: the deciding experiment, which is a minimal page on a physical device or Web Inspector attached to one — not another recipe (#1870).

**the credential chain, closed one step at a time** (#1778–#1790, August 7–8): asking "what do these findings compose into" rather than "is each one severe" found the session cache writing decrypted OAuth tokens *and the DPoP private key* into an unauthenticated Redis, keyed by the bearer token itself. Four steps closed — ciphertext-only cache (#1783), developer-token-only `/rest` (#1784), redis password (#1786), vendors off the uploader-controlled endpoint (#1790) — each verified against the running system rather than the diff. **next in this arc**: the scan-integrity half of #1778 (a `did:web` track's bytes are still served fresh on every request, so a clean scan does not pin what listeners hear) and the transcoder's fail-open auth (#1780), both in known issues; and auditing what a *blob* contains rather than what a field is named.

**the catalog has a spatial surface** (#1766–#1768, August 4): `/atlas` is an unlisted pan/zoom map of every public track, positioned by CLAP-embedding similarity, with haiku-named regions, cover art at deep zoom, and click-to-play through the normal footer player. Rebuilt daily by a GitHub Actions workflow into the stats bucket and proxied at `GET /stats/atlas`. The legal pages were updated in the same window to say plainly that public audio is analyzed and that derived data may be published (#1769), with `terms_last_updated` bumped so existing users are re-prompted. **next in this arc**: a live-radio overlay, deep links, on-map search, and the question of whether the atlas should exist as an ATProto artifact rather than only a page — all deliberately out of v1.

**the player's structural problem is now written down** (#1757–#1762, August 3–4, plus `docs/research/2026-08-03-player-architecture.md`): four bugs in two days — a queue eaten by a stale seek handler, a jam left paused, a station on air and silent after a rapid flip, and server-side rotations teleporting mid-song — were all the same shape: work outliving the load it belonged to on one shared `<audio>` element, or a rotation rebuilt underneath a listener. 22 writers to `player.paused` across 4 files, mode as three unrelated flags, coordination by effect ordering. The research note surveys nine mature players (MPD, mpv, ExoPlayer, AVFoundation, vidstack, shaka, hls.js, feishin, jellyfin-web), which converge on single-funnel element ownership, per-load lifecycles, and explicit mode. **next in this arc**: load-session scoping, the first of five proposed adoptions; and any automated coverage at all for jam, which remains the least-exercised mode.

**radio has a live source** (#1741–#1750, July 30–31 — prod `2026.0730.225420`): the `firehose` station airs relay-eval's sonified atproto firehose live over HLS, modelled as *preemption* of the rotation rather than an entry in it — the loop's position is derived from wall-clock time, and an unbounded broadcast inside it would dissolve that. A broadcast carries its own cover and credits its source, a negative liveness report gets a second opinion from the playlist, and the broadcaster is CDN-fronted so 1000 listeners cost its origin ~5 req/s instead of ~255. It then spent a day on air and silent (#1749, #1750): the tune-in path trusted `canPlayType`, which lies in Chrome, and then awaited a module import inside the tap handler, which spends mobile's autoplay permission. **next in this arc**: the station has no recorded fallback while its segments stay unlisted (see known issues); opening preemption to other broadcasters is gated on moderation, since live audio cannot be fingerprinted before it airs — the design shape (advertisement vs. admission, after sister-radio's syndication write-up) is now captured in #1774.

**the firehose promises neither order nor delivery, and bytes need owners** (#1732–#1740, July 30 — prod `2026.0730.072900`, `.181756`): a repo's commit history was re-emitted upstream and ingest applied each replayed state as current, so commits are now ordered by repo `rev`, which survives re-delivery where jetstream's `time_us` cannot; then the same instance stopped delivering `fm.plyr.*` for 11 hours while still serving Bluesky profile events, so the consumer now rotates across twelve hosts and detects a host gone blind on *our* collections specifically. Separately, staged-upload cleanup had been deleting published tracks' audio — a content-hash `file_id` means re-uploading a file you already published stages the exact key it is served from. 20 tracks across 7 artists broken, 13 recovered; playback now falls back to the artist's PDS blob and the refcount covers every media column. **next in this arc**: ~~an alert~~ shipped (#1775, August 7 — the write-echo blackout alert plus a consumer-liveness heartbeat); schedule `audit_media_integrity.py`; give `_MEDIA_REFERENCES` awareness of `r2_url`.

**moderation: from inert labels to recorded decisions** (#1691–#1718, July 24–27 — prod `2026.0725.035625` → `2026.0728.043224`): `copyright-violation` de-lists instead of doing nothing; adult labels stopped gating permalinks; `LabelContext.LIST` vs `VIEW` keeps labels shaping discovery rather than destinations; and underneath all of it `moderation_events` carries the review queue, per-track overrides, the audit trail, and the source of public transparency posts from @moderation.plyr.fm. Published contact is now `help@plyr.fm` / `dmca@plyr.fm`, and rate limits are keyed per client rather than per site (#1716, #1718). August 8–9 sharpened what those decisions *mean*: `override_exclude` is curation, not removal, so it empties chosen surfaces (feeds, search, radio, atlas) and never a destination anyone navigated to (#1799), and radio and the atlas actually honor it now (#1797). **next in this arc**: triage the 18 queued subjects; merge or discard the transparency-post batching work parked on `feat/batched-transparency-posts` (six curation events currently mean six posts); per-actor authentication, which is what gates agent participation; then a proposed/applied split so an agent can propose a decision a human approves. The DMCA surface itself is still incomplete (see known issues).

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, #1876, epic #1384): private audio in an artist-owned permissioned space (never R2), owner-only, credential-gated playback — end-to-end on staging, in prod with zero private tracks so far. the wire contract is the spaces-alpha lexicons at the tip of atproto's `permissioned-data` branch, with Bulletin as the reference client; zds tracks that branch and has rejected stale bodies twice (#1656, #1876), so drift there shows up as a failed first private upload. The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md`.

**identity, discovery and the queue** (#1620–#1730, July): a broken avatar led to five live artists hidden from every discovery surface because we read one host's `#account` event as a statement about the person — fixed at three levels, and the identity task that maintains the PDS cache is now actually registered with the worker (it had never run in production). The radio no longer plays one artist back-to-back (#1730). An experimental subsonic `/rest` shim lets off-the-shelf clients (Symfonium, Amperfy, Shelv) play plyr libraries with a developer token as the password (#1644–#1651); collection continuity queues the rest of an album or playlist as a labeled "next from" context (#1626); repeat-one shipped (#1653/#1654/#1657), reviving @AilaScott's #1518, with repeat-all deferred until the loop-vs-continuation interaction is designed.

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
- **Logfire retention is shorter than time-to-report** ([#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)): on August 9 the project's earliest record was the same morning. A July 6 PDS-blob failure was therefore undiagnosable a month later — the DB row recorded *that* it failed, never why. Both the new mirroring alert and #1811's failure reasons are only worth as much as the window they survive in. Cheap mitigation for anything we may be asked about later: persist the reason next to the row, which outlives any retention setting.
- **the PDS picker offers tracks this deployment can't read** ([#1814](https://github.com/zzstoatzz/plyr.fm/issues/1814)): `pds_savable_count` checks ungated + no blob + not optimizing, none of which establishes that the bytes are reachable from here. After #1811 the failure is at least legible instead of a bare count, but the honest behavior is not to offer them. Both candidate fixes have an objection — a per-track HEAD is request-time I/O for a metadata endpoint, and an `r2_url`-origin heuristic reintroduces origin-sniffing right after #1805 removed it from the write path — so it wants a deliberate call. A third framing: if the record carries an `audioBlob`, mirror it in (#1778) rather than hide the track.
- **unlike may leave the track in the liked list** ([#1812](https://github.com/zzstoatzz/plyr.fm/issues/1812)): `test_cross_user_like` failed once against staging on August 9 and has passed since. Filed rather than dismissed as flaky, because the assertion describes a read-your-own-write guarantee. Ruled out: stale cache (the liked list is a direct DB query) and a failed delete (it commits before returning). Untested hypothesis: `unlike_track` deletes the row and backgrounds the PDS deletion, so a replayed like-create event could resurrect it — the #1736 family. Track deletes write a tombstone for exactly this reason; likes may have no equivalent.
- **`just backend test` runs serially, CI runs `-n auto`** ([#1815](https://github.com/zzstoatzz/plyr.fm/issues/1815)): the two take different paths through `conftest.py` — serial uses `_setup_database_direct` with no template database, no advisory lock, and no per-worker redis db. The entire parallel bootstrap only ever executed in CI, which is why #1809's bugs were invisible locally despite failing 5/5 once run CI's way. Distinct from the shared-compose-project issue below, which is about *concurrent* sessions rather than parallel workers.
- **pre-#1811 deletes orphaned R2 objects** ([#1367](https://github.com/zzstoatzz/plyr.fm/issues/1367)): track delete and account deletion keyed off `file_id`, so for firehose-ingested rows the delete was a silent no-op and the real object stayed in the bucket with nothing referencing it. Fixed going forward; anything already orphaned is still there. Production has only 5 ingested rows today so the historical blast radius is small, and the sweep that would confirm it is the audit #1367 already asks for.
- **a blind jetstream host permanently discards our events** ([#1796](https://github.com/zzstoatzz/plyr.fm/issues/1796)): rotation's fixed 10s cursor rewind cannot cover a blind window in which bsky traffic kept advancing the cursor (verified in production August 8 — see recent work). Silent loss for third-party-client writes, which the write-echo alert cannot see.
- **parallel agent sessions share one test database** (found August 9): `backend/tests/docker-compose.yml` has no `name:` field, so compose derives the project name from the directory — every checkout/worktree of this repo maps to the same `tests-test-db-1`/`tests-test-redis-1` containers, and two sessions running tests concurrently silently recreate each other's schemas (see the #1801 technical notes for the evening this cost). A `name:` derived from the checkout path, or `COMPOSE_PROJECT_NAME`, would isolate them.
- **PDS-hosted audio is still scanned from a mutable source** ([#1778](https://github.com/zzstoatzz/plyr.fm/issues/1778), narrowed by #1790): the SSRF half is closed — `is_safe_url` now validates the endpoint where a miniDoc enters the system and at both `pds_blob_url` construction sites, and vendors are no longer pointed at the uploader-controlled URL. What remains is the scan-integrity half: a `did:web` track's bytes are served by the user's own host on every request, so a clean copyright scan does not pin what listeners later hear. Pinning the scan to `pds_blob_cid` means fetching and hashing blobs on the track-creation hook — the path #1519 deliberately made non-blocking — so it is a real change, not a validation tweak.
- **the transcoder's auth fails open** ([#1780](https://github.com/zzstoatzz/plyr.fm/issues/1780)): with `TRANSCODER_AUTH_TOKEN` unset it logs a warning and accepts every request, and the app has a public IP. Currently latent — the secret is set and the app is suspended — but `services/moderation/src/auth.rs` returns `SERVICE_UNAVAILABLE` in the same situation, so the transcoder is the outlier and this is a consistency fix.
- **CORS permits every HTTPS origin with credentials** (from #208, closed Feb 2026): `allow_origin_regex` resolves to `^(https://.+|http://localhost:\d+|null)$` with `allow_credentials=True`. Harmless today only because the session cookie is same-site and `SameSite=Lax` is carrying the entire defense — it would become a full CSRF-and-read hole the moment anyone sets `samesite="none"` for an embed, or moves the API off the `plyr.fm` registrable domain. #208's closing summary claimed "CORS validation" and its own item 1 (magic-byte MIME validation) never shipped; uploads still trust the client's `Content-Type`. Worth treating as a lesson about closing security issues against a summary rather than the running system.
- **staging's error-level `SELECT neondb` spans are a pool/suspend mismatch, now mitigated** (August 8): diagnosed and traced to `pool_recycle` (1800s, the default) being **6x longer than staging Neon's `suspend_timeout_seconds` of 300**. The compute scales to zero after 5 minutes idle and kills pooled connections; the next checkout gets a dead one, SQLAlchemy's `handle_error` fires and the OTel instrumentation stamps the span `ERROR` with `str(exc)` — which is empty for this exception class, hence an error with no message and no exception type. Production never sees it because its compute has `suspend_timeout_seconds: -1` (scale-to-zero disabled). **Functionally benign**: all 95 traces containing the error had a succeeding root span (`POST /tracks/` 200 x76, `optimize_track_audio` OK x11, `PUT /audio` 200 x8) — `pool_pre_ping` recovers transparently, so the cost was error-level noise rather than failed requests. `DATABASE_POOL_RECYCLE=240` was set on `relay-api-staging` and **has since been unset — the mitigation was worse than the problem**. Forcing a reconnect every 240s starved concurrent uploads behind the 3-per-artist gate: jobs stuck past ten minutes, the stuck-upload reaper firing repeatedly, and three album integration tests timing out at 300s. Unsetting it removed the timeouts in a single A/B (the failure signature changed from `Timeout (>300s)` to assertion errors, which is what identified it — not pass/fail). The residual assertion failures were debris: `_create_album` is idempotent on `(artist_did, slug)`, so a run killed by pytest-timeout before cleanup leaves its album behind and the next run reuses it and counts double. With the variable unset and the leftovers cleared, integration is green. The `SELECT neondb` noise is therefore back, and staying: it is benign, and the correct fix if it ever matters is disabling scale-to-zero on the staging compute, not shortening `pool_recycle`. The clusters were never "restart noise"; they track integration-test runs (03:25, 03:33, 05:10 on Aug 8; 04:36 on Aug 7), which is what a burst of uploads after an idle window looks like.
- **nothing records listening over time** (August 5 accounting; retention figure corrected August 9): `play_count` is a counter on the track row, so plays-per-day exists only inside Logfire's retention window — which is **far shorter than the 14 days assumed here**: on August 9 the earliest record in the project was the same day at 06:12 (see [#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)). The history before that is unrecoverable. Every day without an append-only play-events table (or a daily `/stats` snapshot) is another day of curve we cannot draw later. Deliberately not built yet — it is new surface, and the shape of it is undecided.
- ~~**the artwork accent wash is inert in production** (#1753)~~ — resolved
  August 10 by the media-bucket CORS policy (#1821). `images.plyr.fm` now sends
  `Access-Control-Allow-Origin: *` and canvas sampling no longer taints;
  verified via `getImageData` from a foreign origin. Wants a look at `/radio`
  to confirm the accent reads well now that it actually renders.
- **the `firehose` station has no recorded fallback** (#1741): waow.tech's sonification segments are `unlisted` and the radio corpus is public-only, so when the broadcast stops the station has nothing to play. It now says "off air" and keeps the tuner reachable (#1744) instead of stranding anyone, but publishing some segments publicly is the only thing that gives it real fallback material — a content decision, not a code one.
- **a failed radio play retries forever** (#1750): while the mobile tune-in was broken, the console logged `playback failed: AbortError` on a loop rather than once — something retries a failed radio `play()` indefinitely. Harmless now that playback works, which is exactly why it is worth writing down: it turned a single failure into continuous noise and would do so again for any future playback fault.
- **live radio is verified under WebKit emulation, not on a phone** (#1750): Playwright's WebKit with iPhone emulation reports `ManagedMediaSource`, so the iOS code path is genuine, but it is neither Mobile Safari nor Android Chrome. Playwright's bundled Chromium is worse for this — it decodes raw HLS natively, so it cannot reproduce the desktop failure at all. Live playback has no automated coverage on a real mobile browser.
- **the rev guard has a one-event window per track** (#1736): `atproto_record_rev` starts `NULL`, and ingest applies-and-learns rather than rejecting when it has no baseline — rejecting would silently drop legitimate edits from other clients. So each track's first update after the release is itself unordered. 6 of 1005 tracks have a rev as of August 9; the rest acquire one when they are next edited. Backfilling from each PDS record would close the window.
- **comment and list updates are still unordered** (#1736): the same last-writer-wins defect exists in `ingest_comment_update` and `ingest_list_update`. Only the track path was fixed, because that is the one that can strand audio bytes.
- **`_reference_count` cannot see `r2_url`** (#1735/#1736): the refcount that guards deletion matches `file_id`-shaped columns, so it cannot protect a row whose `r2_url` and `file_id` name different objects. `prune_revisions` now compensates locally; the general fix belongs in `_MEDIA_REFERENCES`.
- **seven tracks are still dead, and `audit_media_integrity.py` is not scheduled** (#1735/#1737): of the 20 broken by staged-cleanup deletion, 13 were recovered; the remaining 7 have no object in any of our buckets and no PDS blob, because they predate PDS mirroring. Not recoverable by us — the artists almost certainly still hold their source files, so the remedy is asking them to re-upload. The audit script exists and exits 1 on a missing object, but nothing runs it on a schedule yet.
- **the account-status reconciliation script has not been run against prod** (#1729): a dry run reports 5 artists whose `account_status` reason is `NULL` and would be filled in, with zero flags changed. Until it runs, those rows say an artist is hidden without saying why.
- **18 subjects await triage in the review queue** (recounted August 9; the copyright scanner keeps opening new fingerprint flags), still including track 64 (user report #5 from @vicwalker.dev.br). They are visible and playable in the dashboard; nobody has made a call on any of them. A fingerprint match is not a finding — several read as covers or remixes the uploader performed.
- **no per-actor authentication**: the moderation service trusts one shared `MODERATION_AUTH_TOKEN`, so the event log's `actor` is a claim rather than a verified identity. This is the gate on letting an agent *act* rather than propose, and on review genuinely not always being one person.
- **the DMCA surface is incomplete** ([#1715](https://github.com/zzstoatzz/plyr.fm/issues/1715)): the agent is registered and reachable at `dmca@plyr.fm`, but the site does not publish the notice requirements or a counter-notice procedure, and there is no repeat-infringer counter — takedowns are recorded per track in `moderation_events`, never aggregated per uploader. The published-agent half is additionally blocked on a non-residential address.
- `/costs` shows Cloudflare at $0 — upstream gap: CF line items aren't yet tagged `project=="plyr.fm"` in my-prefect-server, so the live feed can't attribute them (#1599).
- **the iOS lock-screen scrubber cannot be dragged in the real app** ([#1870](https://github.com/zzstoatzz/plyr.fm/issues/1870)): metadata, times, and ⏮/⏭ all work; the scrubber never grabs on a physical iPhone under any of five media-session recipes, while SoundCloud's web player scrubs in the same Safari. the deciding experiment — a minimal page on a physical phone, or Web Inspector attached to the device — has not run yet; the code is deliberately parked at the #1860 state.
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
- ✅ downloads — public ungated tracks (lossless originals preferred) and whole albums as cached zips, with a per-artist opt-out
- ✅ repeat-one on the player + queue sidebar toggle
- ✅ experimental subsonic-compatible surface at `/rest` (developer token as password)
- ✅ "keep playing" — opt-in continuous playback from the For You feed when the queue runs dry ("next from: for you")
- ✅ queue items with artwork thumbnails + right-side drag-to-reorder (desktop + touch)
- ✅ unified search with Cmd/Ctrl+K (keyword + mood search in parallel)
- ✅ mood search via CLAP embeddings + turbopuffer (feature-flagged)
- ✅ teal.fm scrobbling
- ✅ moderation on signed ATProto labels — copyright de-listing, adult-audio
  preferences, creator self-labels, an append-only `moderation_events` log
  behind the dashboard queue, and public decision posts from @moderation.plyr.fm
- ✅ display-sized artwork renditions from the Cloudflare edge
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
- ✅ composite covers from member-track artwork when no explicit cover is set
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

this is a living document. last updated 2026-08-21 (**the createSpace body drifted from the spaces-alpha lexicons**. zds moved to the alpha lexicons on August 20 and rejected plyr's pre-alpha `createSpace` body, failing every first private upload on pds.zat.dev; #1877 sends the alpha body and lets `listRepos`/`listRepoOps` page by cursor, #1878 deletes the now-dead pre-DPoP Bearer bridge from #1856. verified old-vs-new body directly against zds, the smoke script, and the live private-media integration in CI; no user impact since prod has zero private tracks. the architecture doc now names the branch-tip lexicons and Bulletin as the contract, and the entry records how plyr's proxying client compares to Bulletin's syncing service.) previously last updated 2026-08-17 (**status maintenance for the August 9–17 window**. Archived the August 3–14 detail block to `.status_history/2026-08.md`, taking STATUS.md from 916 lines to ~410 — the credential chain, the `file_id` storage-key family, the media-bucket CORS policy, the upload memory wedge, and the whole track/album download build-out are now history rather than current state, kept as a single dated cross-reference. Rewrote current focus around the two arcs that are actually live: downloads as a per-artist relationship dial with the redrawn track page and non-modal comments panel around it, and the iOS lock-screen scrubber, which remains unexplained after five media-session recipes and a byte-for-byte revert to #1860. Left the known-issues list intact — nothing in it was retired by this window. Recorded the podcast recap for August 9–17.) previously last updated 2026-08-14 (**albums download as cached zips**. #1836 extends yesterday's download policy to albums — same shared `download_refusal`/`download_key`, zip built on the worker via the export machinery, cached in R2 under a digest of the ordered member keys so edits invalidate naturally, CDN-served by redirect; verified cold-build → SSE → zip → cache-hit on both staging and prod. #1834 brought the regrouped track page's mobile controls up to the 44px touch floor with press feedback on the play disc, punting the material treatment to #1835 rather than hardcoding a token-less one-off. #1837/#1838 fixed the brutal cold-download toast and captured the research as a `toast-copy` skill; #1839 caught the settings copy and docs.plyr.fm up to the feature. also: a 10-day orphaned vite on port 5199 had been silently absorbing every local dev-server start.) previously 2026-08-14 (**an album batch wedged the app VM**. the 02:02 UTC incident: aioboto3's upload reader eagerly queues 100 x 8MB parts per upload by default (~800MB), starving the 1GB app VM into page-cache thrash — process alive, logs/health/SSH all silent, zero 5xx in Logfire because failing requests never reached the app. #1831 capped uploader concurrency and was insufficient; re-review found the io_queue by reading the installed source, #1832 capped it to ~32MB per upload and moved the sync whole-file scans off the event loop. verified with the staging longform-WAV integration test, released clean. retro in docs/internal/runbooks/2026-08-14-upload-memory-wedge.md; open items: machine-level health alerting, app-VM sizing, /tmp exposure.) previously 2026-08-13 (**tracks are downloadable, and the detail page got its sketch**. #1824 adds `GET /audio/{file_id}/download` — presigned attachment named `artist - title.ext`, preferring the lossless original — for anything public, ungated, and un-copyright-labeled, with an `allow_downloads` artist opt-out defaulting on since the artist's PDS already serves the bytes to anyone. one policy module feeds both the endpoint and `TrackResponse.downloadable`, so the UI never offers what the endpoint refuses; adversarial review killed a dead-presigned-URL bug for PDS-only/ingested rows and an unordered scan-row read. #1825 fixed the circular import that crash-looped staging's app process — only uvicorn's import order hits it, so a regression test now imports backend.main in a fresh interpreter. #1826 rebuilt the track detail page to nate's notebook sketch: one controls line (like chip · circular play · bare queue icon), listens, unboxed share/download, `clamp()`ed gaps — the album-context/track-list half of the sketch deliberately punted. verified on prod end-to-end: downloaded the actual 16-bit WAV original with the right filename.) previously 2026-08-10 (**the media hosts never had a CORS policy at all**. An external developer asked for CORS headers to build a web DJ deck; the API has allowed any HTTPS origin since #1106, so the ask read as already-satisfied — but audio bytes come from R2 custom domains, where CORS is configured per-bucket, separately from the FastAPI middleware. All four public buckets returned "The CORS configuration does not exist" (code 10059): preflight 403, and a GET returning 206 with real bytes and no `Access-Control-Allow-Origin`. `<audio src>` playback worked throughout, which is why nothing surfaced it. Shipped `infrastructure/r2/cors.json` (#1821) to `audio-`/`images-{staging,prod}`, deliberately excluding the private buckets — those have no custom domain, `r2.dev` disabled, presigned-only, and `*` there *would* be an access-control change. On the public buckets it is not one: they are already reachable unauthenticated two ways, so `*` grants browsers a read any server-side script already had; no credential surface either, since R2 returns literal `*` and no `set_cookie` passes `domain=`. The bucket policy alone was insufficient — the 1yr edge TTL kept already-cached objects serving their header-less variant and `Vary: Origin` did not rescue them, so the two media hosts were purged by host rather than `purge_everything`. Verified as capability rather than headers: headless Chromium on a foreign origin read 24343244 bytes, decoded them (2ch 44100Hz 138.00s), and pulled 6085800 raw PCM samples. This also closes #1753 — the artwork accent wash was inert for exactly this missing header. Flagged but not addressed: `mirror_pds_blob` re-hosts firehose-ingested audio because a record was published, not because the artist asked — unchanged by CORS, but a real consent question. Also recorded #1818 (`just backend test` ran against **neon dev** rather than the compose postgres it started) and #1817 (plyr publishes a `community.lexicon.app.profile` record).) previously 2026-08-09 (**a track row's `file_id` is not a storage key**. Started from an artist asking why ten tracks weren't on their PDS — nine were the #1565 herd never repaired after June, the tenth failed on July 6 with the telemetry long since aged out. Repairing them surfaced three real defects: the image-origin allowlist was policing what plyr wrote to a creator's *own* repo and rejecting plyr's own pre-`images.plyr.fm` URLs (#1805, removed from the write path — ingest-side trust unchanged); PDS-save failures incremented a counter through four early returns with no log and no reason, so a batch reported "6 failed" with an empty error list and zero rows in Logfire (#1806/#1811); and underneath both, `Track.file_id` addresses storage only for uploads that came through us — on the ingest path it is the record's author-supplied `fileId`/rkey while the bytes live under the content hash in `r2_url`. Eight sites passed it straight into storage, including **track and account deletion, which silently orphaned the real object**, and media export, which silently omitted the track. Fixed via `AudioKey.for_track` and pinned by a source-scanning test that caught a ninth site mid-review. Verified on three production rows belonging to external users — 404 at the old key, 206 at the new one. Also: the portal states "all your audio is on your PDS" when there's nothing to do, a dismissible banner (per-account, not localStorage) surfaces the standing case, its CTA opens the picker directly, and the xdist test bootstrap no longer runs inside a per-test timeout (#1809 — the suite failed 5/5 when run CI's way). Four issues filed rather than carried quietly: #1812–#1815.) previously 2026-08-09 (**status maintenance for the August 5–9 window**. Archived the August 3–8 detail block to `.status_history/2026-08.md`, taking STATUS.md from 722 lines to ~460 — including the redis-password cutover and the write-echo alert's design write-up, both now history rather than current state. Backfilled the one thing this window shipped and never recorded here: **#1790**, which stopped handing AudD, Modal, and Replicate a `getBlob` URL built from an uploader-controlled `did:web` endpoint — a regression test on `main` produced the cloud metadata address from a stored `pds_url` — and replaced it with `mirror_pds_blob`, which fetches once through the hardened client, verifies the bytes hash to the `pds_blob_cid` the record commits to, and keys the copy by content hash rather than the record's attacker-supplied `fileId`. Also recorded the smaller August 8 changes that had no entry: environment-tagged operator alerts (#1793), the PDS-mirror backfill's docket client (#1791/#1792), and the `DATABASE_POOL_RECYCLE=240` staging mitigation being unset after it starved concurrent uploads (#1794). Rewrote current focus around the credential chain and folded the exclude-semantics work into the moderation arc. Recorded the podcast recap for August 5–9.) previously 2026-08-09 (**staleness sweep of known issues, verified against reality**. Retired the #1782 production-requirepass entry — the cutover ran August 8 (plyr-redis v2 + `REDIS_PASSWORD`) and an unauthenticated connection from inside the prod network now gets `AuthenticationError`; the issue is closed. Retired the "write-echo alert unexercised" entry — it fired for real on August 8 as a verified true positive (see the #1796 entry). Recounted the review queue: 18 subjects now await triage (was 13; the scanner keeps opening fingerprint flags), track 64 still among them. Updated the rev-guard coverage to 6 of 1005 tracks. Confirmed still true before keeping: the artwork accent wash stays inert (images hosts still send no `Access-Control-Allow-Origin`), and #1778/#1780 remain open.) previously 2026-08-09 (**search ranks lexical intent above trigram fuzz**. Closed #1523 via #1801, prod `2026.0809.034121`: one tiered relevance — exact > prefix > substring > fuzz — across all five search helpers, `word_similarity()` for intra-tier ties, quotes normalized on both sides; verified on prod that "you don't kn", "you don’t kn", and "you dont kn" all rank the reported title first. Also recorded the discovery that every checkout shares one compose project named `tests`, so concurrent agent sessions recreate each other's test databases — the source of the evening's "stale schema" ghosts, now a known issue.) previously 2026-08-09 (**exclude is curation, not removal, and the blackout alert's first firing**. Applied the override_exclude runbook to a user report of prayer recordings on radio, which surfaced two defects in the paradigm itself: radio never honored the projection (#1797), and exclude applied in every context, briefly blanking the artist's public profile before #1799 made it LIST-only — chosen surfaces exclude, destinations never do. Six events recorded with the transparency publisher paused so one curation call didn't become six posts; a batching implementation is parked on `feat/batched-transparency-posts`. Separately, the #1775 write-echo alert fired for real: jetstream2.us-east was externally verified blind to our collections while three sibling hosts served the same commit, and the 10s rotation rewind permanently skipped the event — #1796 filed for rewinding to the blind-window start. Also confirmed the #1523 search-ranking mechanism: bare trigram `similarity` structurally punishes long titles.) previously 2026-08-08 (**the staging db errors were a pool/suspend mismatch**. Diagnosed the error-level `SELECT neondb` spans that had been written off as restart noise: staging Neon suspends after 300s idle while `pool_recycle` defaults to 1800s, so pooled connections outlive the compute. SQLAlchemy recovers transparently via `pool_pre_ping` -- all 95 affected traces had succeeding root spans -- but the instrumentation stamps the failed attempt `ERROR` with an empty message, because the exception stringifies to "". Production is immune: scale-to-zero is disabled there (`suspend_timeout_seconds: -1`). Set `DATABASE_POOL_RECYCLE=240` on staging. The clusters track integration-test runs, not deploys.) previously 2026-08-08 (**redis had no password, and a redis blip took the whole API down**. Closed the remaining half of #1782: `plyr-redis` now requires a password (#1786), wrapped in `sh -c` because Fly exec's `[processes]` args rather than shelling them — unwrapped, `--requirepass $REDIS_PASSWORD` sets the password to that literal string and looks like it worked. Rehearsing the cutover on staging found a second, worse bug: `slowapi` hands storage exceptions to its rate-limit handler, which reads `exc.detail`, so an unreachable Redis returned `AttributeError` on every request including `/health` — a blip took the whole API down and failed the platform health check. Fixed in #1787 with an in-memory fallback that keeps limits enforced and probes for recovery. Verified by restarting staging redis under load: 150/150 requests returned 200, against the same scenario that produced blanket 500s an hour earlier. The production cutover is staged but not run — held for sign-off.) previously 2026-08-08 (**the session cache was handing out PDS credentials**. An external security assessment led with CSRF, which did not survive contact with the source — the API and frontend are same-site, so `SameSite=Lax` already withholds the cookie cross-site. Chasing "what do these compose into" instead of "is each one severe" found the real thing: `get_session()` decrypted the Fernet-encrypted OAuth blob and cached the plaintext in an unauthenticated Redis for 60s, keyed by the bearer token itself — and the payload included `dpop_private_key_pem`, which collapses DPoP's proof-of-possession back to bearer semantics. Fixed in #1783 (cache the ciphertext, key on sha256, drop the redundant id), #1784 (subsonic `/rest` had accepted any session id, not just developer tokens), #1781 (full session ids in debug logs). Verified by connecting to Redis in both environments and asserting on real entries: production failed every check before the release and passed all of them after. The regression test caught a bug in the fix — returning `None` on an undecryptable entry would have made an OAuth key rotation a mass logout. Transferable lessons in `docs/research/2026-08-08-credential-handling-in-atproto-appviews.md`. Four new known issues recorded rather than quietly carried: unauthenticated `plyr-redis` (#1782), the `did:web` SSRF-by-proxy and mutable-source scan (#1778), the transcoder's fail-open auth (#1780), and a CORS regex admitting every HTTPS origin that #208 closed as "CORS validation" in February.) earlier entries are preserved in `.status_history/2026-08.md`.
