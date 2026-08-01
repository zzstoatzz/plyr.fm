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

#### the live station was on air and silent (#1749, #1750, July 31 — frontend-only releases)

**why**: the day after the `firehose` station shipped, it played nothing. Both bugs were
in the same six lines of the tune-in path, both were platform behaviour we had assumed
rather than checked, and both presented identically to a listener: current cover art, a
LIVE badge, a "stop" button, and no sound.

**what shipped**: live radio actually plays — on desktop, and then on mobile.

**technical notes**:
- **`canPlayType` is not a capability check.** The player asked
  `canPlayType('application/vnd.apple.mpegurl')` and used hls.js only if the answer was
  empty. Chrome answers `"maybe"` and then cannot demux the MPEG-TS segments behind the
  playlist, so we handed the element a source it would never decode. The precedence is
  now inverted to match hls.js's own guidance: hls.js drives the broadcast wherever
  `Hls.isSupported()`, and native `src` is the fallback for the browsers where native
  HLS is real. The lazy-load property is unchanged — nothing without a live HLS source
  fetches the module.
- **an `await` inside a tap handler spends the tap.** #1749's fix awaited
  `import('hls.js')` before the element had media, which is fine on desktop and fatal on
  mobile: autoplay permission is only granted to a `play()` running in the same task as
  the gesture. The station read "stop" while the console looped `AbortError`. hls.js is
  now warmed as soon as `/radio/state` reports a live broadcast — long before anyone
  taps — so attaching is synchronous inside the gesture. Warming on *state*, not on
  page load, keeps the cost tied to the thing that needs it.
- **iOS wants `disableRemotePlayback` before it will attach.** It drives HLS through
  ManagedMediaSource, which the platform refuses to hand to an element still advertising
  AirPlay.
- **each fix was verified by measuring the audio element, not by reading the UI.**
  `readyState`, `paused`, `currentTime` and `webkitAudioDecodedByteCount` — the desktop
  bug is invisible to a screenshot, and the mobile one was reproduced under WebKit with
  iPhone emulation, where production showed `readyState: 1` / `paused: true` and the fix
  showed `readyState: 4` with `currentTime` advancing. Worth recording the limit too:
  Playwright's bundled Chromium *does* decode the raw playlist, so it could not
  reproduce the desktop failure at all. The evidence for #1749 was never a reproduction
  — it was that the old code's correctness rested on a check known to lie.

#### radio grew a live source, starting with the firehose itself (#1741–#1746, July 30 — releases `2026.0730.195751` → `.225420`)

**why**: a continuous publisher had been simulating a live stream by replacing three
tracks' audio every five minutes. That workaround is what produced the revision churn
behind #1732, the replay corruption in #1736, and a player stuck at `0:00 / 0:00`.
plyr had no way to express "someone is broadcasting right now", so the publisher
expressed it with the only primitive available — a static track, mutated 288 times a
day. Fighting the symptoms meant raising retention caps; the actual gap was a missing
concept.

**what shipped**: a `firehose` station airing relay-eval's sonified atproto firehose
live over HLS, and the model that makes live audio a property of the radio we already
had rather than a second kind of radio.

**technical notes**:
- **live is preemption, not a rotation entry.** The rotation's position is *derived* —
  `loop_offset = epoch_seconds % loop_duration` — which is what lets every listener
  compute the same "now playing" with no server state, and what makes `/radio/state`
  cacheable. A broadcast has no known duration, so putting one in the loop leaves the
  loop with no period and dissolves that property entirely. Modelling it as preemption
  keeps the loop running as the clock it is: a live show interrupts automation, and
  when it ends automation resumes wherever wall-clock time has got to. That is also
  just how radio works. The practical payoff is that stations, lenses, the sampler and
  #1525's airtime-fairness work are all untouched — `Station` gained one optional
  field.
- **the allowlist is the `STATIONS` tuple.** Who may preempt is a curation decision
  made in code, not something a publisher asserts about itself. Live audio cannot be
  fingerprinted before it airs and the entire moderation pipeline assumes a stored
  file, so opening this to other broadcasters is a separate decision gated on
  moderation rather than one inherited from this change.
- **`live` is additive on the state response.** A client that predates the field plays
  the rotation as before, which on this station means the recorded fallback — a
  coherent degrade rather than a broken one. hls.js is imported only when a live
  station is tuned on a browser without native HLS, so the other four stations and all
  queue playback never download it.
- **a broadcaster's status bit must not be able to take a station off air on its own.**
  relay-eval reported `live: false` for roughly 40 minutes while its playlist kept
  advancing and its segments decoded fine; plyr believed it and showed OFF AIR over
  audio anyone could have played. They fixed the endpoint (`live` now derives from the
  newest segment in the playlist), but the failure mode was worth designing out: a
  *negative* report now gets a second opinion from the playlist itself — no
  `#EXT-X-ENDLIST`, and a `PROGRAM-DATE-TIME` on the newest segment within 45s. A
  positive report is still trusted immediately with no extra fetch.
- **three self-inflicted bugs, every one caught by loading the page and none by the
  API.** The page gated its entire on-air block on a rotation entry existing, so a live
  station with an empty rotation rendered "no tracks in rotation yet" *and* omitted the
  tuner — a dead end, made effectively permanent because the station choice persists in
  localStorage, so bare `/radio` kept restoring it. Separately, covers were being
  cropped to a tall slice (pre-existing on all four stations: `height: 100%` resolved
  against the stage and beat `aspect-ratio`, so a square 1200×1200 cover rendered
  478×846). Fixing that left a dead band under the artwork where the stretched cover
  used to be, because `.art-stage` and `.now-block` were still growing to fill space
  nothing occupied any more.
- **a broadcast carries its own cover.** relay-eval renders one per interval, so
  `artwork_url` is read per-probe rather than baked into station config, and renders
  through the normal cover path. The station also credits its source: `source_url` on
  the station links the description to relay-eval.waow.tech/sonify, modelled as a field
  rather than a link hardcoded to one slug — the corpus-backed stations correctly have
  none.
- **the broadcaster is now CDN-fronted.** At ~108 kbps per listener plus an
  uncacheable playlist, 1000 concurrent listeners meant ~108 Mbps and ~500 req/s
  against a single Hetzner box that also runs the eval collectors, the live-rate meters
  and the encoder — listener load would have degraded the very measurements the audio
  is made of. Segments cache immutably (unique names, content never changes); the
  playlist takes `s-maxage=2`, comfortably under one segment duration, which is the
  line that matters for liveness. Tiered Cache needs a paid *zone* plan — account-level
  Workers/R2/Images subscriptions do not grant it — but it is a rounding error here:
  ordinary edge caching already takes origin load from ~255 req/s to roughly 5, because
  it scales with POP count rather than listener count.

#### the firehose promises neither order nor delivery (#1736, #1739, #1740, July 30 — release `2026.0730.181756`)

**why**: a continuous publisher was replacing the audio on three unlisted tracks
every five minutes, and the player started showing `0:00 / 0:00` with a pause
button. The first suspects were all wrong: the retention cap (#1732), the
staged-cleanup incident (#1733/#1734), and a frontend race in `Player.svelte`.

The PDS records were correct the whole time — the right `audioUrl` at a CID unchanged
for half an hour, with no plyr write since. Yet ingest received **37 `track.update`
events for one URI**, carrying *different historical* record values: the row's `r2_url`
read the 06:32 revision at 07:05, the 06:37 revision at 07:11, and the current one at
07:22. A repo's commit history was being re-emitted upstream (confined to that one repo
— zero events for any other DID in 40 min), and ingest applied each state as if current.

**what shipped**: commits are ordered by repo `rev` — a TID, monotonic per repo,
and unlike jetstream's `time_us` it survives re-delivery (`time_us` is stamped on
receipt, so it cannot tell a replay from a fresh write). An update at or below the
applied rev is refused. The #1616 existence check now runs on the update path, and
prune reference-safety considers the URL a row actually *serves*.

**technical notes**:
- **the ingest doc claimed all tasks are idempotent under cursor rewind.** True for
  create and delete, which dedupe by AT-URI; false for update. It also justified
  skipping the existence check on update because "an update can only mutate an
  already-ingested track" — which is exactly what got corrupted.
- **the damage is not the transient wrong audio.** A replayed `r2_url` can name a blob
  since pruned as an old revision: `/audio/{file_id}` 307s to a dead key, the element
  never loads metadata, and the 1-year edge TTL caches the 404. Prune couldn't see it
  either — its reference set was `file_id`s, while the served object is named by `r2_url`.
- **it corrupts metadata too.** Track 1201's title regressed by an hour while its cover
  and audio stayed current; the guard rejects the whole commit, so nothing can regress.
- **not fixed by ignoring `audioUrl` on update.** plyr honors record updates because
  [@cinny.bun.how](https://bsky.app/profile/cinny.bun.how) pointed out in March 2026
  (#1068–#1076) that writing to a PDS without listening is not how the protocol works.
  The bug was trusting delivery *order*, not trusting the record.
- **then the same instance stopped delivering entirely** (#1739). `fm.plyr.*`
  dispatches went to zero for 11 hours while `app.bsky.actor.profile` kept flowing at
  39–73/hour, so the consumer looked healthy the whole time and nothing alerted. Not
  our bug and not the relay's — relay1 reported a byte-identical latest commit to the
  PDS itself. Subscribing to both jetstream instances for the same DID over one window
  settled it: jetstream1 delivered 10 `fm.plyr.track` commits, jetstream2 delivered
  none. The morning's replay burst reads as the same instance degrading before it went
  quiet.
- **so the client stopped depending on any one host** (#1740). Twelve hosts, the same
  list zat's client defaults to, round-robin on each reconnect, with the cursor rewound
  10s on switch because instances are independently positioned in the stream (safe now
  that updates are rev-ordered; a gap would not be). Rotation alone would not have
  caught this outage, though — jetstream2 never disconnected, so there was no error to
  trigger a reconnect and nothing to fail over *from*. The consumer therefore tracks
  our own collections separately from all traffic: other events arriving while ours
  stay silent means the host is blind and we rotate; both silent means the network is
  quiet and we stay put. Bluesky's profile collection is excluded from "ours" on
  purpose, since that is exactly the traffic that made a blind host look alive.

#### we had been deleting listeners' audio (#1732–#1735, #1737, July 30 — releases `2026.0730.064616` → `.072900`)

**why**: chasing the `0:00 / 0:00` report above surfaced a separate, older
defect — 20 tracks across 7 artists dead in production. A `file_id` is a content
hash, so re-uploading a file you already published stages *the exact R2 key the
published track is served from*. The duplicate check then rejects the upload and
the orchestrator's failure cleanup deletes "its" staged object: the live track's
only copy. Eight months unnoticed, because it needs a re-upload of an
already-published file to fire.

**what shipped**:
- staged cleanup refuses to delete an object with **any** reference (#1733).
  `delete()` tolerates exactly one, because a track being deleted *is* that
  reference; nothing legitimately references a staged object, so one reference
  means the bytes are someone else's.
- `/audio/{file_id}` falls back to the artist's PDS blob when R2 has no object
  (#1734) — root cause #2 of the 2026-06-30 retrospective, still verbatim true,
  which is why 12 tracks with perfectly good PDS blobs were dead.
- the refcount walks **every** media column — `Track` audio *and* image, `Album`,
  `Playlist` — in one query (#1735). Images had been protected by nothing at
  all: the audio-only refcount returns 0 for an image, and `delete_image()` had
  no refcount whatsoever, so two tracks sharing a cover could each delete the
  other's object. `scripts/audit_media_integrity.py` now answers "does the object
  each row points at exist", exiting 1 so it can be scheduled and page.
- the retrospective's own claims were corrected (#1737): only 4 of the 20 are
  *proven* to be this bug — Logfire retains ~14 days — track 53 was a
  bucket-migration gap (found intact in `audio-dev`, copied over, 20 broken → 7),
  and "permanently lost" became "not recoverable by us", which is a materially
  different thing to tell an artist.

**the class, not the instance**: three incidents now — the "banana mix"
refcount, the 2026-06-30 dead `audioUrl`, and this one — share a shape.
*Something referenced bytes it didn't own, or trusted a pointer it hadn't
verified.* Content-addressed keys give bytes no owner, so "these bytes" and
"this row's media" are different questions and every deletion path was asking
the narrow one.

#### an artist can't air twice in a row (#1730, July 29 — release `2026.0729.213641`)

the `loved` station played the same artist three tracks in a row, during a live
stream. The sampler had a per-artist *airtime* cap (~20 minutes) and no notion
of *clustering*, so a heavily-weighted creator's tracks could all land adjacent
— measured up to six consecutive on a synthetic corpus. `build_rotation` now
draws only from artists outside a 3-entry spacing window and repairs the
tail→head seam (the rotation is a loop, so its last entries neighbour its
first). Longest same-artist run 6 → 1, verified on live prod `loved` after the
release. The change that mattered was drawing from an eligible subset rather
than draw-then-reject: the old loop popped a track and skipped it if its artist
was over budget, so a dominant artist burned the draws that should have aired
someone else. Spacing relaxes rather than starves when no other artist is
drawable, and the airtime cap still bounds how *much* one artist gets — this
bounds only how *clustered*.

#### what an `#account` event actually says, and the task that never ran (#1725–#1729, July 29 — releases `2026.0729.193914`, `.213641`)

[@brookie.blog](https://plyr.fm/u/brookie.blog)'s avatar rendered as broken alt
text. Pulling that thread found five live artists — 12 tracks — hidden from
radio, the home feed, and for-you, one of whom had uploaded two days earlier and
one of whom filed the platform's first user report. The lexicon says it plainly:
an `#account` event describes *the host that emitted it*, "not necessarily that
at the currently active PDS". Leaving a PDS deactivates your repo on the host
you left, which then truthfully reports `active=false, status=deactivated` about
itself and misleadingly about you. All five had migrated off a Bluesky-hosted
PDS.

Fixed at three levels: `hides_content(active, status)` hides only for
account-level statuses, so `throttled`/`desynchronized` (infrastructure) now
change nothing; the *current* PDS is asked rather than a cached one; and
`ingest_identity_update` — the task that maintains that cache — was finally
registered with the docket worker. It had **never once executed in production**:
docket resolves tasks by name at execution time, so it was dropped with a log
line on the *worker* while the dispatch site succeeded and looked healthy (35
`Unknown task` drops over two weeks → 0). The two bugs compounded —
`Artist.pds_url` was stale *because* the dropped task was the one PDS migration
would have refreshed. The dry run earned its keep: the reconciliation script
asked the *cached* PDS and proposed 15 updates, 12 of them live artists who had
simply moved.

Also in the cluster: Bluesky avatars mirror through jetstream (#1726 — nothing
had subscribed to `app.bsky.actor.profile`, measured at 2.3 events/s
network-wide, ~110 MB/month, zero extra network calls), and a tag containing a
slash is reachable (#1725) via `{tag_name:path}`, since ASGI decodes
percent-escapes before routing. Full detail in `.status_history/2026-07.md`.

#### a label's reach, and operational hygiene (#1709–#1718, July 25–27 — releases `2026.0725.172537`, `2026.0728.043224`)

`LabelContext.LIST` vs `VIEW` splits surfaces we chose for you (feeds, search,
radio) from destinations you navigated to (artist page, album, permalink). Adult
labels filter LIST only, which stopped an artist's own detail page from hiding
tracks from the one page whose entire purpose is to show that catalogue;
copyright filters both, because it is a hosting obligation rather than a
listener preference; and neither ever gates audio bytes. Applied at every
filtering call site, with count queries using the same clause as the list they
count. One public answer at [docs.plyr.fm/moderation](https://docs.plyr.fm/moderation).

Alongside it: published contact moved to `help@plyr.fm` / `dmca@plyr.fm` with
the DMCA agent filing updated and the privacy policy corrected to describe what
is actually collected (#1716); and rate limits are keyed per client rather than
per site (#1718) — the old key was Fly's proxy address, so `default_limits` was
one bucket for the entire site, and prod returned 298 429s on `/radio/state`
alone as radio listeners polling every 30s knocked each other offline. Full
detail in `.status_history/2026-07.md`.

#### earlier July (#1620–#1706, July 1–25)

See `.status_history/2026-07.md` for detailed history: the moderation arc —
**labels that act** (#1697: `copyright-violation` de-lists, adult labels stopped
gating bytes, the ten pre-#703 published labels retracted), the **moderation
event log** (#1699–#1706: an append-only `moderation_events` table behind the
dashboard queue, per-track overrides, and public decision posts from
@moderation.plyr.fm), and the **service boundary + fail-open label cache**
(#1691–#1695). Before that: **at-tags meta** (#1690) and **copyright mix
detection** (#1689); **operator labels projected into SQL** (#1688, which fixed
a week of broken logged-out pagination); **adult-audio labels** (#1676, #1677,
#1682); **playlist composite covers**, **edge image renditions**, and the **July
14 radio compute incident** (#1660–#1675); and the July 1–9 cluster — radio
rotation breadth (#1620), radio play counts + teal scrobbles (#1622),
post-login intent preservation (#1624), collection continuity (#1626, #1627,
#1632), the storybook + enforced axe accessibility gate (#1634–#1642), the
subsonic `/rest` surface (#1644–#1651), and repeat-one (#1653, #1654, #1657).

### June 2026

See `.status_history/2026-06.md` for detailed history (firehose dead-audioUrl verification #1616; copyright flags no longer silently wiped #1615; status-recap transcript #1613; client-logo keyline #1608/#1609; CF Pages lockfile incident #1606/#1607; live-infra costs feed #1599 + jetstream identity propagation #1603/#1604; ALAC-in-m4a transcode + radio/embed autoplay hardening #1596/#1597/#1598; local-dev fresh-DB onboarding #1584–#1586 + collections/design-system refactor #1579–#1591; the permissioned-data member-list pivot #1573/#1574; the June 10 prod release `2026.0610.034454`; radio embed station switching #1571; lexicon docs #1569; the private-media probe #1557→#1567; and the radio-stations + tuner-dial cluster #1530→#1548).

### November 2025 – May 2026

See `.status_history/` for detailed history, one file per month:
`2026-05.md`, `2026-04.md`, `2026-03.md`, `2026-02.md`, `2026-01.md`,
`2025-12.md`, `2025-11.md`.

## priorities

### current focus

**radio has a live source** (#1741–#1746, July 30 — prod `2026.0730.225420`): the `firehose` station airs relay-eval's sonified atproto firehose live over HLS, modelled as *preemption* of the rotation rather than an entry in it — the loop's position is derived from wall-clock time, and an unbounded broadcast inside it would dissolve that. A broadcast carries its own cover and credits its source, a negative liveness report gets a second opinion from the playlist, and the broadcaster is CDN-fronted so 1000 listeners cost its origin ~5 req/s instead of ~255. It then spent a day on air and silent (#1749, #1750, July 31): the tune-in path trusted `canPlayType`, which lies in Chrome, and then — once fixed — awaited a module import inside the tap handler, which spends mobile's autoplay permission. Both are now verified by measuring the audio element rather than by reading the UI. **next in this arc**: the station has no recorded fallback while its segments stay unlisted (see known issues); opening preemption to other broadcasters is gated on moderation, since live audio cannot be fingerprinted before it airs.

**the firehose promises neither order nor delivery** (#1736, #1738–#1740, July 30 — prod `2026.0730.181756`): a repo's commit history was re-emitted upstream and ingest applied each replayed state as current, walking one track's `r2_url` back 19 minutes and another's title back an hour. Commits are now ordered by repo `rev`, which survives re-delivery where jetstream's `time_us` cannot. Then the same instance stopped delivering `fm.plyr.*` for 11 hours while still serving Bluesky profile events, so nothing looked wrong — the consumer now rotates across twelve hosts and detects a host gone blind on *our* collections specifically. **next in this arc**: an alert, because none of this pages anyone.

**media integrity** (#1732–#1735, #1737, July 30 — prod `2026.0730.072900`): staged-upload cleanup had been deleting published tracks' audio, because a content-hash `file_id` means re-uploading a file you already published stages the exact key it is served from. 20 tracks across 7 artists were broken; 13 recovered. Playback now falls back to the artist's PDS blob, the refcount covers every media column rather than audio alone, and `scripts/audit_media_integrity.py` can page on a row pointing at a missing object. **next in this arc**: schedule that audit, and give `_MEDIA_REFERENCES` awareness of `r2_url` (see known issues).

**moderation: from inert labels to recorded decisions** (#1691–#1718, July 24–27 — prod `2026.0725.035625` → `2026.0728.043224`): `copyright-violation` de-lists instead of doing nothing; adult labels stopped gating permalinks; `LabelContext.LIST` vs `VIEW` keeps labels shaping discovery rather than destinations; and underneath all of it `moderation_events` carries the review queue, per-track overrides, the audit trail, and the source of public transparency posts from @moderation.plyr.fm. The labeler's service-to-service endpoints moved to `/internal/*`, and a `subscribeLabels` subscriber closed a fail-open label cache from ~300s to ~0.8s. **next in this arc**: triage the 13 queued tracks; per-actor authentication, which is what gates agent participation; then a proposed/applied split so an agent can propose a decision a human approves.

**operational hygiene** (#1716, #1718, July 27 — prod `2026.0728.043224`, `2026.0729.193914`): published contact is `help@plyr.fm` / `dmca@plyr.fm` with the DMCA agent filing updated, the privacy policy describes what is actually collected, and rate limits are keyed per client rather than per site. The DMCA surface itself is still incomplete (see known issues).

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, epic #1384): private audio in an artist-owned permissioned space (never R2), owner-only, credential-gated playback — end-to-end on staging, **in prod but inert** (only ZDS implements this experimental surface). The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md` and `.status_history/2026-06.md`.

**subsonic surface** (#1644–#1651, July 4–6): an experimental `/rest` shim so off-the-shelf subsonic clients (Symfonium, Amperfy, Shelv, ...) play plyr libraries with a developer token as the password. built client-by-client against real failures; expect gaps until more clients are exercised. **collection continuity shipped** (#1626, July 2): tapping a track inside an album/playlist now queues the rest as a labeled "next from" context — Part B of continuous playback, previously held pending the queueable-surfaces design call (albums & playlists in; artist catalogs #1353 and feeds/search still open). **repeat-one shipped** (#1653/#1654/#1657, July 9), reviving @AilaScott's #1518; repeat-all deliberately deferred until the loop-vs-continuation interaction is designed.

**identity is not a single host's opinion** (#1725–#1730, July 29 — prod `2026.0729.193914`, `.213641`): a broken avatar led to five live artists hidden from every discovery surface because we read one host's `#account` event as a statement about the person. Fixed at three levels: only account-level statuses hide anyone, the *current* PDS is asked rather than a cached one, and the identity task that maintains that cache is now actually registered with the worker — it had never run in production. Bluesky avatars now mirror through jetstream. Also: tags containing a slash resolve (#1725), and the radio no longer plays one artist back-to-back (#1730).

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
- **nothing alerts a human when firehose ingest goes quiet** (#1739): the 11-hour blackout produced no page and was found only because a publisher's tracks looked wrong. #1740 makes the consumer heal itself and logs a warning when it rotates away from a blind host, but that is a breadcrumb, not an alarm. A Logfire alert on "zero `fm.plyr.*` dispatches in N minutes" is the missing piece, and the most valuable thing left from this window.
- **the `firehose` station has no recorded fallback** (#1741): waow.tech's sonification segments are `unlisted` and the radio corpus is public-only, so when the broadcast stops the station has nothing to play. It now says "off air" and keeps the tuner reachable (#1744) instead of stranding anyone, but publishing some segments publicly is the only thing that gives it real fallback material — a content decision, not a code one.
- **a failed radio play retries forever** (#1750): while the mobile tune-in was broken, the console logged `playback failed: AbortError` on a loop rather than once — something retries a failed radio `play()` indefinitely. Harmless now that playback works, which is exactly why it is worth writing down: it turned a single failure into continuous noise and would do so again for any future playback fault.
- **live radio is verified under WebKit emulation, not on a phone** (#1750): Playwright's WebKit with iPhone emulation reports `ManagedMediaSource`, so the iOS code path is genuine, but it is neither Mobile Safari nor Android Chrome. Playwright's bundled Chromium is worse for this — it decodes raw HLS natively, so it cannot reproduce the desktop failure at all. Live playback has no automated coverage on a real mobile browser.
- **the rev guard has a one-event window per track** (#1736): `atproto_record_rev` starts `NULL`, and ingest applies-and-learns rather than rejecting when it has no baseline — rejecting would silently drop legitimate edits from other clients. So each track's first update after the release is itself unordered. 3 of 997 tracks have a rev so far; the rest acquire one when they are next edited. Backfilling from each PDS record would close the window.
- **comment and list updates are still unordered** (#1736): the same last-writer-wins defect exists in `ingest_comment_update` and `ingest_list_update`. Only the track path was fixed, because that is the one that can strand audio bytes.
- **`_reference_count` cannot see `r2_url`** (#1735/#1736): the refcount that guards deletion matches `file_id`-shaped columns, so it cannot protect a row whose `r2_url` and `file_id` name different objects. `prune_revisions` now compensates locally; the general fix belongs in `_MEDIA_REFERENCES`.
- **seven tracks are still dead, and `audit_media_integrity.py` is not scheduled** (#1735/#1737): of the 20 broken by staged-cleanup deletion, 13 were recovered; the remaining 7 have no object in any of our buckets and no PDS blob, because they predate PDS mirroring. Not recoverable by us — the artists almost certainly still hold their source files, so the remedy is asking them to re-upload. The audit script exists and exits 1 on a missing object, but nothing runs it on a schedule yet.
- **the account-status reconciliation script has not been run against prod** (#1729): a dry run reports 5 artists whose `account_status` reason is `NULL` and would be filled in, with zero flags changed. Until it runs, those rows say an artist is hidden without saying why.
- **13 tracks await triage in the review queue**, including track 64 (user report #5 from @vicwalker.dev.br). They are visible and playable in the dashboard now; nobody has made a call on any of them. A fingerprint match is not a finding — several read as covers or remixes the uploader performed.
- **no per-actor authentication**: the moderation service trusts one shared `MODERATION_AUTH_TOKEN`, so the event log's `actor` is a claim rather than a verified identity. This is the gate on letting an agent *act* rather than propose, and on review genuinely not always being one person.
- **the DMCA surface is incomplete** ([#1715](https://github.com/zzstoatzz/plyr.fm/issues/1715)): the agent is registered and reachable at `dmca@plyr.fm`, but the site does not publish the notice requirements or a counter-notice procedure, and there is no repeat-infringer counter — takedowns are recorded per track in `moderation_events`, never aggregated per uploader. The published-agent half is additionally blocked on a non-residential address.
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

this is a living document. last updated 2026-07-31 (**the live station was on air and silent**. Documented #1749/#1750: the `firehose` station shipped and then played nothing. `canPlayType('application/vnd.apple.mpegurl')` answers "maybe" in Chrome, which cannot demux the MPEG-TS behind it, so hls.js now drives the broadcast wherever it is supported and native HLS is the fallback rather than the default. That fix then broke mobile, where autoplay is only granted to a `play()` in the same task as the tap and the dynamic `import('hls.js')` spent it — hls.js is warmed when `/radio/state` reports a live broadcast instead. New known issues: a failed radio play retries forever, and live playback is verified under WebKit emulation rather than on a real phone.) previously 2026-07-31 (**status maintenance for the July 25–31 window**. STATUS.md had grown back to 739 lines, so the July 10–29 detail moved to `.status_history/2026-07.md`: the label-context split #1709–#1713, contact addresses and per-client rate limits #1716/#1718, the moderation event log #1699–#1706, labels-that-act #1697, the operator-label SQL projection #1688, and the playlist-covers / edge-renditions / July-14-compute-incident cluster #1660–#1675, plus the account-status and artist-spacing write-ups #1725–#1730. Backfilled the one thing this window had shipped and never recorded here: **#1732–#1735/#1737**, where staged-upload cleanup had been deleting published tracks' audio — a content-hash `file_id` means re-uploading a file you already published stages the exact key it is served from, so the duplicate check rejected the upload and the failure cleanup deleted the live track's only copy. 20 tracks across 7 artists broken, 13 recovered, and the retrospective's own over-claims corrected in #1737. Rewrote current focus around the live-radio, firehose-ordering and media-integrity arcs and dropped the four moderation bullets that had become history. New known issue: seven tracks are not recoverable by us, and the media-integrity audit is not scheduled. Recorded the podcast recap for July 25–31.) previously 2026-07-31 (**radio grew a live source**. Documented #1741–#1746: `firehose` airs relay-eval's sonified atproto firehose live over HLS, modelled as *preemption* rather than a rotation entry, because the rotation's position is derived from wall-clock time and an unbounded broadcast in the loop would dissolve that. Also extended the #1736 entry: jetstream2 stopped delivering `fm.plyr.*` for 11 hours while still serving Bluesky profile events, so the consumer looked healthy and nothing alerted; the client now rotates across twelve hosts and detects a host gone blind on our own collections.) previously 2026-07-30 (**the firehose does not promise order**. Documented #1736: a repo's commit history was re-emitted upstream and `ingest_track_update` applied each replayed state as current. Commits are now ordered by repo `rev`, which survives re-delivery where jetstream's `time_us` does not.) previously 2026-07-29 (**identity is not a single host's opinion**. Documented #1725–#1730: an `#account` event describes the host that emitted it, not the person, and five migrated artists were hidden from every discovery surface as a result; `ingest_identity_update` had never once executed in production.) previously 2026-07-28 (**where a label reaches, and operational hygiene** — #1709–#1718). previously 2026-07-25 (**status maintenance for the July 2–25 window**, and **labels that act** #1697). earlier entries are preserved in `.status_history/2026-07.md`.
