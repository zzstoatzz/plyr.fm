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

#### an artist can't air twice in a row (#1730, July 29 — release `2026.0729.213641`)

**why**: the `loved` station played the same artist three tracks in a row,
during a live stream. The sampler had a per-artist *airtime* cap (~20 minutes)
and no notion of *clustering*, so a heavily-weighted creator's tracks could all
land adjacent — measured up to six consecutive on a synthetic corpus.

**what shipped**: `build_rotation` draws only from artists outside a 3-entry
spacing window, and repairs the tail→head seam (the rotation is a loop, so its
last entries are neighbours of its first). Longest same-artist run 6 → 1,
verified on live prod `loved` after the release.

**technical notes**:
- **draw from an eligible subset, don't draw-then-reject.** The old loop popped a
  track and skipped it if its artist was over budget, so a dominant artist burned
  the draws that should have aired someone else. Eligibility is now computed
  before the draw, and both the weighted path and the exploration floor use it.
- **spacing relaxes rather than starves**: with no other artist drawable the
  window is dropped for that draw, so a thin corpus still fills a rotation. Seam
  repair is likewise bounded, and skipped entirely when there is only one artist.
- the cap still lets one long mix be a large share of a single loop — unchanged
  and deliberate. This bounds how *clustered* an artist is, not how *much*.

#### what an `#account` event actually says, and the task that never ran (#1725–#1729, July 29 — releases `2026.0729.193914`, `.213641`)

**why**: [@brookie.blog](https://plyr.fm/u/brookie.blog)'s avatar rendered as
broken alt text. Pulling that thread found five live artists — 12 tracks —
hidden from radio, the home feed, and for-you, one of whom had uploaded two days
earlier and one of whom filed the platform's first user report.

**what shipped**:
- **avatars mirror from Bluesky** (#1726). Nothing subscribed to
  `app.bsky.actor.profile` — all five jetstream subscriptions were our own
  lexicons — so a profile-picture change never reached us and the superseded blob
  CID 404s on the CDN. Measured cost before subscribing: 2.3 events/s network-wide,
  ~110 MB/month, and zero extra network calls (the commit embeds the blob ref).
- **`ingest_identity_update` had never once executed in production** (#1726). It
  was never registered with the docket worker; docket resolves tasks by name at
  execution time, so it was dropped with a log line *on the worker* while the
  dispatch site succeeded and looked healthy. 35 `Unknown task` drops over two
  weeks → 0 after.
- **account status is per-host, and six statuses are not one boolean** (#1727,
  #1728). `hides_content(active, status)` in
  `_internal/atproto/account_status.py` hides only for account-level statuses;
  `throttled`/`desynchronized` are infrastructure and now change nothing. The
  status is stored alongside the flag, so a hidden artist can be *explained*.
- **a tag containing a slash is reachable** (#1725). The ASGI layer decodes
  percent-escapes before routing, so `7%2F4` became the path `/tracks/tags/7/4`
  and matched no route; `{tag_name:path}` fixes it. Slash was the only character
  that broke, because it is the only structural path separator.

**technical notes**:
- **the lexicon says it plainly**: an `#account` event describes the host that
  emitted it, "not necessarily that at the currently active PDS". Leaving a PDS
  deactivates your repo *on the host you left*, which then truthfully reports
  `active=false, status=deactivated` about itself — and misleadingly about you.
  All five hidden artists had migrated off a Bluesky-hosted PDS. #1727 first
  attributed this to PDS flapping (real, in the logs, but not the cause); #1728
  corrected it.
- **the two bugs compounded.** `Artist.pds_url` was stale *because*
  `ingest_identity_update` was the dropped task — PDS migration fires `#identity`,
  which would have refreshed the cache. One bug kept the cache pointing at the
  host that would go on to report them deactivated.
- **the dry run earned its keep**: the reconciliation script asked the *cached*
  PDS and proposed 15 updates, 12 of which were live artists who had simply moved.
  Running it would have applied the exact bug in bulk.
- **"cannot tell" must never mean "gone."** The flag is no longer sticky on a
  missed reactivation edge, and an unreachable host does not hide anyone.

#### a label's reach: where filtering applies, and where it doesn't (#1709–#1713, July 25–27 — release `2026.0725.172537`)

**why**: #1697 made `copyright-violation` de-list, and the filter was applied
wherever tracks were queried — including an artist's own detail page, which
quietly removed tracks from the one page whose entire purpose is to show that
artist's catalogue. The question that broke it open: if you are *already on the
artist's page*, discovery has happened. Hiding there isn't protecting anyone
from an unwanted encounter; it is telling a visitor the artist has less work
than they do.

**what shipped**:
- `LabelContext.LIST` vs `LabelContext.VIEW` in
  `backend/_internal/content_labels.py`. LIST is a surface we chose for you
  (feeds, search, radio); VIEW is a destination you navigated to (artist page,
  album, playlist, permalink). Adult labels filter LIST only (#1709).
- the context applied at *every* filtering call site, not just the ones that
  were obviously wrong — and count queries fixed to use the same clause as the
  list they count, so a page no longer says "12 tracks" above nine rows (#1712).
- [docs.plyr.fm/moderation](https://docs.plyr.fm/moderation): one surface-by-surface
  table answering "does a label hide this?", plus the internal counterpart
  enumerating each call site and its context (#1710, #1713).

**technical notes**:
- **this mirrors ATProto's own `contentList`/`contentView` split** — a post can
  be blurred in a feed and fully visible when opened directly. The difference is
  where the decision is made: Bluesky's client decides per render; plyr decides
  per query, because filtering has to be a WHERE clause to compose with cursor
  pagination (the #1688 lesson).
- **copyright ignores the context; adult labels don't.** An adult label is a
  listener preference, so a listener who navigated somewhere deliberately has
  already expressed it. Copyright is a hosting obligation — we serve the bytes,
  and no listener's preference discharges that. So the LIST/VIEW branch wraps
  only the adult half.
- **the artist always sees their own catalogue**: the adult clause carries an
  owner exemption. This made the first end-to-end test vacuous — run as the
  track's owner, every LIST check passed regardless of the label.
- **labels never gate bytes.** `may_stream_sensitive_audio` returns `True`
  unconditionally. A label changes what we *put in front of you*, never whether
  a link you already hold resolves.

#### contact addresses, and rate limits that are actually per client (#1716, #1718, July 27 — #1716 in prod as `2026.0728.043224`; #1718 staging only)

**why**: a pass over what a hobby project with no legal entity is actually
obliged to have. Two things were wrong. Published contact addresses pointed at a
personal mailbox and the DMCA agent filing named it. And the privacy policy
described collecting IP addresses "for rate limiting and abuse prevention" —
boilerplate that had never been true, which is the worse kind of policy error:
it describes a practice you don't have rather than omitting one you do.

**what shipped**:
- `help@plyr.fm` and `dmca@plyr.fm` via Cloudflare Email Routing, forwarding to
  the project mailbox; every published address switched; the registered DMCA
  agent record updated to match. Verified by a real SMTP conversation to
  `RCPT TO` against Cloudflare's MX, including a control address that must be
  refused (it is — no catch-all).
- the privacy policy now describes what is actually collected (#1716).
- rate limits keyed per client (#1718). The key was `get_remote_address` →
  `request.client.host`, which behind Fly's proxy is the same `172.16.7.50` for
  everyone. With shared Redis storage, `default_limits` was one bucket for the
  *entire site*: prod peaked at 124 requests/minute against a 100/minute ceiling
  and returned 298 429s on `/radio/state` alone — radio listeners polling every
  30 seconds, knocking each other offline.

**technical notes**:
- **a global limiter is worse than no limiter for availability**: it converts
  one busy client into a site-wide outage while doing nothing about the client.
- the key prefers session, then bearer token, then IP — all hashed. A session
  follows the person rather than the network, so it is both more accurate (two
  people behind one NAT stop throttling each other) and better for privacy: an
  authenticated request never has its address used for anything. An IP is the
  key only for anonymous callers, lives as a Redis key carrying the window's
  TTL, and is never written to the database or the logs. That is the practice
  the policy now describes.
- verified on staging end-to-end: 130 concurrent anonymous requests → exactly
  100 served, 30 refused, and a credential-carrying request served immediately
  after. **Not yet in prod** — #1718 needs `just release`.

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

**bugs found by shipping it**: `NOT (NULL = 'exclude')` is NULL, which a WHERE
clause drops, so the first override cut hid the entire catalogue (12 failing
tests caught it); an autogenerated migration proposed dropping two tables and
four indexes from local dev drift; and transparency posts shipped first with a
404 policy link, then with no link facets at all — Bluesky does not infer links
from text. Detail in `.status_history/2026-07.md`.

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
2026-01-02 legal review concluded *"either don't flag it, or flag it and act on
it."* #703 did the first half and deferred the second to a pipeline nobody
built, leaving ten published labels publicly queryable for ~7 months, while
adult enforcement was built end-to-end in July during a live incident. Two
systems built under opposite pressures, reconciled here (full account in
`.status_history/2026-07.md`).

**deliberately not done**: no uploader notification — pointing a new
notification pipeline at a backlog would DM people about December flags, so any
notification must fire on new events only. No per-track override yet (see
known issues). Not adopting Ozone: Acorn's moderation is a customized Ozone
fork, but Ozone wants to own the labeler DID we already run, adds a VPS and
Postgres, and its UI targets Bluesky posts rather than audio — borrowing its
event-log model instead.

#### moderation service boundary + a fail-open label cache (#1691–#1695, July 24–25 — release `2026.0725.035625`)

the moderation service's `/admin/*` prefix mixed two unrelated consumers behind
one auth middleware — the htmx dashboard a human opens, and the hot-path
endpoints the backend calls. The six service-to-service endpoints moved to
`/internal/*` (#1692, #1693), served from one route table nested at both
prefixes so the deprecated aliases cannot drift; the operator surface
deliberately stayed put, and the three moderation scripts collapsed onto one
shared client (#1694, −146/+25).

**the thing worth remembering**: verifying the rename end-to-end on staging
surfaced a fail-open window unrelated to it. The label cache is keyed by subject
URI and is **viewer-independent**, so one playback by anyone caches "no labels"
for everyone; `emit_label` invalidates only for labels *the backend* emitted,
and operators emit straight to the labeler. A track labeled while its cache
entry was warm kept serving audio for the full 300s TTL — on the one endpoint
designed to fail closed. A `subscribeLabels` consumer now invalidates each
subject as the labeler commits it (#1695), measured at **0.8s instead of ~300s**,
reading the stream rather than having the labeler call back so the dependency
points one way. Full detail, including the `POST /admin/batches` empty-list
lesson, in `.status_history/2026-07.md`.

#### at-tags meta + copyright mix detection (#1689, #1690, July 23–24)

track, album, playlist, and artist pages emit at-tags meta (#1690). Copyright
scanning now flags mixes of copyrighted songs rather than only single-song rips
(#1689) — a sustained-match count threshold, so a DJ mix stitched from several
commercial tracks no longer slips through a per-song score gate.

#### operator labels projected into SQL (#1688, July 23 — release `2026.0723.190620`)

logged-out pagination of the home feed had been broken since #1676 (July 16):
adult-label visibility could not be expressed in SQL — operator labels lived
only in the moderation service, reachable per-request over HTTP — so #1676
filtered app-side *after* the query, which corrupts cursor bookkeeping. Any page
containing a labeled track reported `has_more: false` and everything older
silently vanished. Fixed at the storage layer rather than the symptom: a
`tracks.operator_labels` JSONB column, reconciled every 5 minutes by a docket
Perpetual task against a new `/labels-by-value` labeler endpoint, following the
`copyright_scans.is_flagged` precedent. Visibility is a WHERE clause again and
pagination is back to plain `limit + 1`. The sync client **raises** on labeler
failure so an outage can never be read as "nothing is labeled" and wipe the
projection; byte-serving authorization still queries the labeler live. ~12
filter call sites stopped making transitive HTTP calls.

#### adult-audio labels + sensitive-content policy (#1676, #1677, #1682, July 16–17)

See `.status_history/2026-07.md` — generic signed labels, the separate
`show_sensitive_audio` preference, creator self-labels, and the operator/access
runbook gaps the live incident exposed. The byte-level gate it introduced was
removed on July 25 (#1697); its app-side filtering caused the #1688 pagination
bug.

#### playlist composite covers, edge image renditions, and a radio compute incident (#1660–#1675, July 10–16)

**playlist composite covers** (#1663–#1665, #1675): playlists without an explicit
cover now adopt their member tracks' artwork — a 2×2 mosaic at 4+ distinct
artworks, the first track's art below that (spotify's thresholds, so nothing
novel to tune). Public playlists keep their items on the PDS, so the list
endpoint has no member tracks to derive art from; a cached
`playlists.preview_thumbnails` (JSONB) column solves it, refreshed on item
mutations and self-healed on detail reads — which also catches edits made against
the PDS record by other ATProto clients. Two follow-ups: nothing could *unset* an
explicit cover, so composites could never take over (#1664), and the first cut
cached 96px thumbnails and stretched four across a 400-device-px hero (#1675).

**display-sized artwork from the CDN edge** (#1672): the radio page served
artists' full-resolution originals — the live rotation included **5.3MB and 4.1MB
JPEGs** rendered into a ~400px hero and 40px thumbnails. Zone-level Cloudflare
image transformations are now on, and a provider-abstracted `resizedImageUrl`
helper requests per-slot renditions: 34× smaller at 640w, ~2000× at 96w on the
worst offender. `SensitiveImage` still receives the canonical URL, so moderation
matching is unaffected.

**radio rotation caching after a prod incident** (#1671): on July 14 radio-poll
volume tripled and every `/radio/state` poll rebuilt the station rotation from
the full eligible catalog — `pg_stat_statements` showed the no-LIMIT
eligible-tracks query had run **61,615 times returning 55.7M rows**, saturating
the 2-CU prod Neon compute and dragging unrelated routes' p95 to ~1.9s (one
traced request spent 20.7s inside a single SELECT). The rotation is
deterministic per (station, limit, period) by design, so it is now cached in
redis at a 60s TTL with a `SET NX EX` single-flight lock so expiry can't
stampede. Only the *anonymous* rotation is cached; the viewer's likes are
overlaid per request, so a signed-in warmup cannot leak `liked=True` to
anonymous listeners. #1620's full-catalog corpus load is unchanged — its
frequency was the bug, not its shape.

**the staging integration suite is green again** (#1660, #1661): red since ~June
4, last green May 14. #1660 found two workflow defects — an `always()` prune step
killed skipped runs with exit 127, and a missing mint secret *skipped* rather
than failed, which is what hid the fact that #1630's JIT token pipeline had never
been wired at all. Wired and un-skipped, the suite ran for the first time in a
month and surfaced a month of rot: deferred transcodes asserted too early, a
moved supporter-gate contract, an SDK lock bump across a namespace redesign.
**22 passed** on the July 25 runs. `test_private_media.py` stays excluded — it
needs local postgres/redis fixtures.

**queue and radio polish** (#1667–#1670): "clear queue" no longer vetoes
keep-playing (clearing your picks is not opting out of continuation); the empty
up-next region accepts drops; the radio like button opens the same add-to menu as
everywhere else (−163 lines); the redundant queue chip and dishonest shuffle
tooltip are gone.

#### earlier July (#1620–#1657, July 1–9)

See `.status_history/2026-07.md` for detailed history: radio rotation breadth
(#1620 — per-station rank decay, 4h reseeding, exploration floor: `loved` and
`deep-cuts` went from 8% to ~55% of the catalog aired); radio play counts + teal
scrobbles (#1622 — signed-in radio listening had never fired `/play`);
post-login intent preservation (#1624); collection continuity (#1626, #1627,
#1632); browserless + JIT dev-token minting (#1629–#1631); the storybook harness
and enforced axe accessibility gate (#1634–#1642); the subsonic `/rest` surface
built client-by-client (#1644–#1651); the radio embed boundary fix (#1652); and
repeat-one on the player (#1653, #1654, #1657).

### June 2026

See `.status_history/2026-06.md` for detailed history (firehose dead-audioUrl verification #1616; copyright flags no longer silently wiped #1615; status-recap transcript #1613; client-logo keyline #1608/#1609; CF Pages lockfile incident #1606/#1607; live-infra costs feed #1599 + jetstream identity propagation #1603/#1604; ALAC-in-m4a transcode + radio/embed autoplay hardening #1596/#1597/#1598; local-dev fresh-DB onboarding #1584–#1586 + collections/design-system refactor #1579–#1591; the permissioned-data member-list pivot #1573/#1574; the June 10 prod release `2026.0610.034454`; radio embed station switching #1571; lexicon docs #1569; the private-media probe #1557→#1567; and the radio-stations + tuner-dial cluster #1530→#1548).

### November 2025 – May 2026

See `.status_history/` for detailed history, one file per month:
`2026-05.md`, `2026-04.md`, `2026-03.md`, `2026-02.md`, `2026-01.md`,
`2025-12.md`, `2025-11.md`.

## priorities

### current focus

**moderation: from inert labels to recorded decisions** (#1697–#1706, July 25): the arc of the window. `copyright-violation` de-lists instead of doing nothing; adult labels stopped gating permalinks; and underneath both, `moderation_events` now carries the review queue, per-track overrides, the audit trail, and the source of public transparency posts from @moderation.plyr.fm. The dashboard finally shows the work it exists to show — it had been reading labels, so scan flags were structurally invisible. **next in this arc**: triage the 13 queued tracks; per-actor authentication, which is what gates agent participation; then a proposed/applied split so an agent can propose a decision a human approves.

**moderation service boundary + label-cache correctness** (#1691–#1695, July 24–25 — prod `2026.0725.035625`): the labeler's service-to-service endpoints now live under `/internal/*`, structurally separate from the `/admin/*` moderator dashboard, with aliases retained for one deploy cycle. Verifying that rename end-to-end turned up the more important bug: the label cache is keyed by subject URI and viewer-independent, so any playback cached "no labels" for everyone and an operator-emitted label had no effect on audio byte authorization for up to 300s — fail-open on the endpoint designed to fail closed. A `subscribeLabels` subscriber closes it to ~0.8s. (both follow-ups shipped the same day: the stream now refreshes the `operator_labels` projection, and the remaining `/admin/*` aliases cover only the six pre-split endpoints.)

**pagination, page weight, and poll cost** (#1660–#1675, #1688, July 10–23 — prod `2026.0723.190620`): three defects with the same shape — work done in the wrong layer. Adult-label filtering ran app-side after the query and broke logged-out cursor pagination for a week (#1688, now a WHERE clause against a projected column); artwork was served at full resolution into 40px thumbnails (#1672, now edge renditions — up to 34× smaller on the 640w hero); and the station rotation was rebuilt from the whole catalog on every `/radio/state` poll, which saturated prod Neon compute on July 14 (#1671, now a 60s redis cache with single-flight). Also: playlists without a cover adopt their tracks' artwork as a 2×2 mosaic (#1663–#1665, #1675), and **the staging integration suite is green again** after five weeks red (#1660/#1661).

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, epic #1384): private audio in an artist-owned permissioned space (never R2), owner-only, credential-gated playback — end-to-end on staging, **in prod but inert** (only ZDS implements this experimental surface). The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md` and `.status_history/2026-06.md`.

**subsonic surface** (#1644–#1651, July 4–6): an experimental `/rest` shim so off-the-shelf subsonic clients (Symfonium, Amperfy, Shelv, ...) play plyr libraries with a developer token as the password. built client-by-client against real failures; expect gaps until more clients are exercised. **collection continuity shipped** (#1626, July 2): tapping a track inside an album/playlist now queues the rest as a labeled "next from" context — Part B of continuous playback, previously held pending the queueable-surfaces design call (albums & playlists in; artist catalogs #1353 and feeds/search still open). **repeat-one shipped** (#1653/#1654/#1657, July 9), reviving @AilaScott's #1518; repeat-all deliberately deferred until the loop-vs-continuation interaction is designed.

**where a label reaches** (#1709–#1713, July 25–27 — prod `2026.0725.172537`): labels shape discovery, not destinations. `LabelContext.LIST` vs `VIEW` splits surfaces we chose for you (feeds, search, radio) from surfaces you navigated to (artist page, album, permalink); adult labels filter the former only, copyright filters both, and neither ever gates audio bytes. Documented once, publicly, at [docs.plyr.fm/moderation](https://docs.plyr.fm/moderation) so the question has one accurate answer.

**operational hygiene** (#1716, #1718, July 27 — prod `2026.0728.043224`): published contact is now `help@plyr.fm` / `dmca@plyr.fm` (Cloudflare Email Routing, DMCA agent filing updated), and the privacy policy describes what is actually collected. Rate limits are keyed per client instead of per site — the old key was Fly's proxy address, making `default_limits` one bucket for everyone. Both are now in prod (#1718 shipped in `2026.0729.193914`).

**identity is not a single host's opinion** (#1725–#1730, July 29 — prod `2026.0729.193914`, `.213641`): a broken avatar led to five live artists hidden from every discovery surface because we read one host's `#account` event as a statement about the person. Fixed at three levels: only account-level statuses hide anyone, the *current* PDS is asked rather than a cached one, and the identity task that maintains that cache is now actually registered with the worker — it had never run in production. Bluesky avatars now mirror through jetstream. Also: tags containing a slash resolve (#1725), and the radio no longer plays one artist back-to-back (#1730).

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
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

this is a living document. last updated 2026-07-29 (**identity is not a single host's opinion**. Documented #1725–#1729: a broken avatar on @brookie.blog led to five live artists — 12 tracks — hidden from radio, feeds, and for-you, because an `#account` event describes *the host that emitted it*, not the person, and leaving a PDS makes the host you left report you deactivated. All five had migrated. Fixed at three levels: `hides_content(active, status)` so infrastructure statuses hide nobody, asking the current PDS instead of a cached one, and registering `ingest_identity_update` — the task that maintains that cache, which had never once executed in production. Bluesky avatars now mirror through jetstream (#1726), and a tag containing a slash resolves (#1725). Also #1730: the radio's per-artist airtime cap bounded how *much* one artist got but not how *clustered*, so `loved` played the same artist three in a row on stream — draws are now artist-spaced, longest run 6 → 1. Corrected the stale note that #1718 was staging-only; it reached prod in `2026.0729.193914`. New known issue: the account-status reconciliation script hasn't been run against prod, so 5 hidden artists carry a `NULL` reason.) previously 2026-07-28 (**where a label reaches, and operational hygiene**. Documented #1709–#1713: the `LabelContext.LIST` vs `VIEW` split, which stopped adult labels from hiding tracks on the artist's own detail page — labels shape discovery, not destinations — applied the context at every filtering call site so counts agree with the rows they count, and published one accurate public answer at docs.plyr.fm/moderation. Also #1716/#1718: published contact moved to `help@plyr.fm` / `dmca@plyr.fm` with the DMCA agent filing updated and the privacy policy corrected to describe what is actually collected; and rate limits keyed per client rather than per site, closing a bug where Fly's proxy address made `default_limits` one bucket for the entire site (298 429s on `/radio/state`). New known issue: the DMCA surface is incomplete (#1715) — no published notice requirements, no counter-notice procedure, no repeat-infringer counter. #1718 is verified on staging but not yet released to prod.) previously 2026-07-25 (**status maintenance for the July 2–25 window**. Archived the July 1–17 entries to `.status_history/2026-07.md` and collapsed the November 2025–May 2026 cross-references, since STATUS.md had gone over its 500-line ceiling. Backfilled the previously undocumented July 10–23 cluster: the **operator-label SQL projection** #1688, which fixed a week of broken logged-out pagination caused by app-side filtering after #1676; **playlist composite covers** #1663–#1665/#1675; **edge artwork renditions** #1672 (5.3MB JPEGs were being served into a 400px hero and 40px thumbnails); the **July 14 radio compute incident** #1671, where rebuilding the rotation on every poll saturated prod Neon compute; and **queue polish** #1667–#1670. Removed the integration-suite known issue — it is green again after five weeks red (#1660/#1661, 22 passed). Recorded the podcast recap for July 2–25.) previously 2026-07-25 (**labels that act** #1697 — `copyright-violation` now de-lists from radio and discovery instead of doing nothing, and adult labels stopped gating audio bytes so creators' permalinks work for signed-out listeners; the organizing idea is that a label is a portable assertion while enforcement is local hosting policy, which is why adult defers to the listener and copyright cannot. Retracted the ten pre-#703 public labels. Traced the asymmetry to the 2026-01-02 legal review, whose "flag it and act on it" half was deferred in #703 and never built. New known issues: no per-track override, and three flagged-but-unlabeled tracks needing triage). previously 2026-07-25 (documented the July 23–25 window and the `2026.0725.035625` prod release: the **moderation service boundary** #1691–#1694 — service-to-service endpoints moved to `/internal/*` with `/admin/*` aliases for one deploy cycle, the operator surface deliberately left in place, and the three moderation scripts collapsed onto one shared client; the **fail-open label cache** #1695 — found while verifying the rename end-to-end on staging, a URI-keyed viewer-independent cache meant an operator-emitted label had no effect on audio byte authorization for up to 300s, now closed to ~0.8s by a `subscribeLabels` subscriber; plus **at-tags meta** #1690 and **copyright mix detection** #1689. New known issue: negation recovery still waits on the ~5-minute `operator_labels` projection sync). previously 2026-07-20 (aligned private media with ATProto permissioned-data Proposal 0016: canonical addresses, space-type/permission-set separation, client attestations, host resolution, and sync read foundations; #1684). previously 2026-07-16 (documented the sensitive-audio response, labeler rollout, affected tracks 1177–1179, and the access/operator-tooling gaps). earlier entries (2026-07-09 and before) are preserved in `.status_history/2026-07.md`.
