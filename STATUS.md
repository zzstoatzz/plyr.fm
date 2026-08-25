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

#### a processing track looks processing before you press play (#1934, August 24 — prod, frontend-only promote)

**why**: an AIFF (or recorder webm/ogg) upload publishes immediately on an
interim raw rendition that Chrome and Firefox can't decode; until the deferred
optimize task swaps in the mp3 — 4m40s and 4m52s for the two uploads that
prompted this — the only signal was a toast *after* the click. Woody hit it
within minutes of uploading.

**what shipped**: track rows, cards and the track page now derive
`isAwaitingPlayableRendition(track)` up front (server `is_optimizing` &&
`!canPlayFormat`) — artwork and title dim, a clock badge sits in the artwork
corner where the gated lock goes, "· processing" replaces "· lossless" in the
row meta (the interim is lossless on paper but unplayable here), and the play
control is inert. The click-time toast stays as the fallback for queued and
auto-advanced tracks. No polling: the state flips on the next payload refresh.
Safari plays AIFF natively, so it sees the track live while Chrome sees it
greyed — a faithful reflection of what would happen on click.

**follow-ups filed**: #1932 — the "new track" DM fires on create, before a
playable rendition exists for these uploads; #1933 — of the ~4.5 min, ~90s is
just streaming the source from R2 to the api machine's disk before ffmpeg runs.

**also**: a draft PR to mu.social (eurosky-social/eurosky-social-app#199)
extends its existing `plyr_track` embed to `plyr_album` and `plyr_playlist`,
so album and playlist links render inline players there. nate will ping mu
about review; the 380px height matches plyr's own oEmbed answer for
collections.

---

#### the queue header settles on three matching buttons (#1924, August 23 — prod)

**why**: the header carried three square icon buttons and one uppercase text
pill, plus a repeat control the player bar already owns.

**what shipped**: repeat left the header (the player bar keeps it); clear
became the same 32px square as jam and shuffle, with a list-x glyph from the
same icon family as add-to-queue (list+) and the swipe reveal (list-minus).
Applies to both the queue and jam headers; the pill's words live on as
title/aria-label.

#### queue polish round two: keyboard, races, physics everywhere (#1914–#1922, August 23 — prod, frontend-only promotes; reorder engine promoted with #1924's release)

**why**: nate drove the queue hard on staging and prod and kept filing what he
felt: no keyboard path after the X went away, toasts that looked crude and
spoke in two voices, adds that "weirdly disappear", a reorder that felt cheap
on mobile, and a desktop that quietly kept an older, worse reorder.

**what shipped**:
- keyboard on a focused queue row: arrows move, delete/backspace removes
  (focus stays in the list). the first cut also bound `l` to like — it
  shadowed the global `l` = next-track and nate called it out: a shortcut
  collision is a question, not a silent contextual override. reverted
  (#1915); a like key waits on his pick. both lessons are now `self-review`
  checklist items (#1918), along with "reuse an existing action's copy"
  (#1917: the queue toasted bare "liked" while the menu said "liked <title>").
- toasts wear the app's glass (#1916): the container hardcoded a dark rgba in
  both themes — wrong in light. now the same color-mix surface, glass border
  and shadow as the queue cards. aesthetic only, per nate.
- two real races (#1919), diagnosed from staging spans (11 PUT + 12 GET + a
  409 in one minute): a 409 on `PUT /queue/` adopted server state wholesale,
  discarding the mutation whose toast had just fired (refresh showed it once a
  later push rewrote it); and even a 200's echo snapshot clobbered anything
  done mid-flight. now: a conflict re-pushes local intent once under the new
  revision (a second conflict concedes — another writer is real), and a
  mutation-epoch guard skips stale echoes. plus: the swipe dismiss left a
  height-0 wrapper that the keyed each handed back to a re-added track — an
  invisible row with the count disagreeing (nate's screenshot).
- gesture discrimination (#1920): the swipe used to die at the first pointer
  event where vertical wobble edged past 6px — exactly how a thumb-arc swipe
  opens. now 8px of travel, one decision, swipes winning to ~53° off-axis.
- reorder physics (#1921, #1922): rows are measured once at pickup
  (`reorder-plan.ts`, pure and unit-tested); the lifted row scales under a
  real shadow (escaping its swipe wrapper's clip), neighbours animate out of
  the way iOS-home-screen style, a subtle accent line marks the landing gap,
  haptics tick on pickup and slot change. #1922 unified it: native HTML5 drag
  is deleted, mouse and touch share the engine (mouse: vertical drag anywhere
  on the row; the swipe owns horizontal via the same mirrored 0.75 bias), and
  the landing line moved from viewport space to the scroll container's content
  space — the "line in the wrong spot" was a `scrollTop` bug.

**technical notes**: the row now has exactly two pointer grammars — horizontal
= swipe, vertical = reorder — partitioned by one bias constant, with scroll
untouched on touch except from the drag handle. feel constants (scale 1.03,
180ms spring, line at 55% accent) are each one line if nate wants to tune.

#### queue swipe actions, hints, and the anti-slop sweep (#1907–#1912, August 23 — prod, frontend-only promote)

**swipe** (#1907, #1908): a queue row swiped right reveals a heart (like /
unlike), left a trash (remove from the queue), mouse or finger — Spotify's
queue gesture. threshold 35% of the row (72px floor); one-to-one tracking to
the threshold then rubber-band resistance; spring snap-back; a committed
remove slides the row out and collapses its slot; crossing the threshold pops
the icon with a haptic where offered. verified in a real browser (desktop +
390×844 touch) against the staging API. #1908 also fixed a phone regression
nate caught on staging: the wrapper's overflow:hidden let flex items shrink,
clipping every row — flex-shrink: 0.

**anti-slop** (#1909): doodl's oxlint plugin (15 rules) now runs in
`bun run lint` after eslint. all 237 findings across 91 files fixed at the
root — casts removed by real narrowing, runtime typeof replaced by boundary
parsing or `browser`, open dictionaries by named contracts, vi.mock by real
modules (three minimal seams: player.importHls, playlist load's ssr default
arg, RadioEmbed reading window.location). two SAFETY one-liners remain. an
independent review pass found three nits, fixed pre-merge (null at the queue's
JSON boundary, half-converted safe-storage writes, an untested default).

**follow-ups from nate's staging review** (#1911, #1912): the X button is
gone — swipe-left is the removal; the reveal dropped the red trash for the
app's own surface (muted panel, list-minus glyph, accent when armed) since
queue removal isn't destructive and shouldn't look scary. moving the cheese
introduced one-time **versioned hints** (`id@version` in
`ui_settings.seen_hints`, server-merged, device-local when signed out; bump
the version when a mechanism changes) with `queue-swipe@1` as the first. and
the empty-queue "find something to play" CTA now closes the full-screen
mobile queue when it navigates, styled as a real 44px button. promoted with
nate's go-ahead as `production-fe` @ 6979bc1c.

**process**: `change` and `self-review` skills now encode the delivery flow
(PR → self-review → merge = staging → nate reviews → promote via `deploy`).
lesson repeated with a new face: the post-merge e2e raced the **Pages**
deploy this time (HTML/chunk skew, pages stuck unhydrated with zero
requests); a local production build was healthy and the re-run passed —
diagnose the deploy window before suspecting the change.

#### editing a track deleted its audio from the PDS (#1904, August 22 — prod `2026.0822.185531`)

**why**: nate's 4:32 am upload went to his PDS — `uploadBlob` 200 and the record
rewritten with `audioBlob` by the deferred optimize task — and his edit nine
minutes later deleted it. `rebuild_track_pds_record`, which every metadata edit
runs, rebuilt the record from the row with `audioUrl` only and never passed
`audio_blob`. The official PDS garbage-collects a blob no record references
(`sync.getBlob` → "Blob not found"), and jetstream ingest mirrored the blob-less
record back into the DB: `audio_storage='r2'`, `pds_blob_cid=NULL`, with the
stale `pds_blob_size` left behind — the fingerprint.

**blast radius**: 66 production tracks across 21 artists since March 18 carry
the fingerprint (graham.systems 7, whereditgo.diamonds 6, darkhart 6, …). Their
audio exists only in R2 now. Repairing them means re-uploading from R2 and
rewriting each record — a PDS write on other people's behalf — **not done**;
nate's call on consent (heads-up post or opt-in).

**what shipped**: the rebuilt record carries `audioBlob` built from the row
(cid, mime from the file type, size) next to `audioUrl`, the pairing the
publish and optimize paths already use. Regression test drives `PATCH` and
asserts the `putRecord` payload keeps the blob; it failed on the old code.

#### plyr never stores membership — access is the space credential (August 23)

The access list shipped on August 22 decided who may see and hear private
tracks from a `private_media_members` table that was refreshed from the PDS
only when the artist opened their member list in the portal. That made the
artist's attention in plyr a dependency of other people's access: an artist
who added someone from pdsls (or any other client) left that person a stranger
to plyr indefinitely, and someone they removed kept seeing the tracks and got
a 403 on play — an existence tell — until the artist happened to visit. It was
the only mirror in the backend kept current by a UI action; every other one
is event-driven or scheduled. Wrong, and not inherited from anywhere.

Now the authority answers. `backend/_internal/private_access.py` asks the
artist's space host for a credential with the reader's own session and holds
only that answer for as long as the protocol says it is good: a credential for
its lifetime, a refusal for five minutes (the same window a verifier's answer
gets in `atprotofans.py`), an unreachable host for no time at all. Nothing is
refreshed by anything the artist does in plyr; add/remove through plyr only
drop what plyr holds for that pair so the next request asks at once. Listings
show the private tracks of artists the viewer currently holds a credential
for and never fan out into mints; an artist's page asks for that one artist
first. A refusal at read time is now the same 404 as a missing file. The
table, model, mirror code and reconcile are gone (migration `a81c2d9e4f07`);
`GET /me/private-media/members` reads the PDS every time and says so (502,
with a retry in the portal) when the PDS cannot answer, instead of showing a
copy. Design: `docs/internal/architecture/private-media-access-list.md` §3.
Sources: Daniel Holmgren's "Boring Auth" diary and Nick Gerakines' "Space
Access" (both via pub-search), `notes/protocols/atproto/spaces.md`.

#### private media grows an access list (#1876–#1905, August 21–22 — prod `2026.0821.071650` → `2026.0822.185531`)

Full write-up in `.status_history/2026-08.md`. Four days took private media from
owner-only to an artist-named list of people who can hear it:

- **the contract caught up** (#1876–#1878): zds moved to the published
  spaces-alpha lexicons on August 20 and rejected plyr's pre-alpha
  `createSpace` body with `400 Missing policy`, failing every first private
  upload; `ensure_personal_space` now sends the alpha body, space reads page by
  cursor, and the pre-DPoP Bearer bridge is deleted.
- **the grant is the capability** (#1881, #1885, #1891, #1903): deciding "can
  this PDS do spaces" from advertised `scopes_supported` was wrong — the
  reference `oauth-provider` never lists dynamic scopes, so the official
  alpha PDS looked incapable. Every sign-in now requests
  `include:<ns>.privateMediaAccess`; a spaces PDS expands it into `space:`
  grants at consent, others leave it unexpanded, and a PAR `invalid_scope`
  retries without it. Legacy sessions take a one-time upgrade that holds the
  in-flight upload or recording across the redirect.
- **members** (#1897–#1901, #1905): the `simplespace` member list on the
  artist's PDS is the source of truth. Both private audio paths mint from the
  *requesting* session, so a member streams through their own PDS's delegation
  token; non-members still 404. (This first shipped with a `private_media_members`
  mirror refreshed only when the artist opened their list in plyr — removed the
  next day, see below.) The portal gained a "private tracks" section for adding and removing by
  handle. Refusals now match the `getSpaceCredential` lexicon names instead of
  500ing. Membership and supporter standing stay separate facts by design —
  design doc: `docs/internal/architecture/private-media-access-list.md`.
- **verification**: a real session on `nate.spaces-alpha.bsky.network` (the
  official implementation) created a space, wrote the record, and streamed it
  back through the credential proxy; Playwright drives the private-media and
  `/record` flows against staging on every merge to main (#1887–#1889).

#### August 14 – 17 (archived)

See `.status_history/2026-08.md` for detailed history:

- **comment timestamps seek on the first click** (#1873) — the seek fired
  against the previous source because `resolveAudioSource` attaches
  asynchronously; now a `pendingSeek` applied by the matching track's
  `loadeddata`.
- **the iOS lock-screen scrub unwind** (#1860–#1869, open as #1870) — ⏮/⏭,
  metadata and times work; the scrubber does not grab on a physical iPhone, and
  everything after #1860 was reverted byte-for-byte because none of it changed
  on-device behavior.
- **teal scrobbles write the production lexicons** (#1823); **slugs
  transliterate instead of deleting** (#1858, `tūnņg` → `tunng`); **space
  credentials are DPoP-bound** (#1856).
- **comments became a non-modal docked panel and the track page finished its
  redesign** (#1843–#1855) — timestamp emissions from the trigger, the count
  flash traced to two real bugs, like whimsy zeroed under
  `prefers-reduced-motion`.
- **artists choose a download policy** (#1841, #1842) — open / ask /
  supporters / off, defaulting to `ask` when the artist has a support link, one
  `download_refusal`/`download_key` pair behind three endpoints.

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

**the queue became a direct-manipulation surface** (#1907–#1924, August 23 — prod, mostly frontend-only promotes): a queue row now has exactly two pointer grammars, partitioned by one bias constant — horizontal is swipe (right likes, left removes, and swipe is now the *only* remove), vertical is reorder. The reorder engine measures rows once at pickup into a pure, unit-tested plan, lifts the dragged row under a real shadow, displaces neighbours iOS-home-screen style, and marks the landing gap with an accent line; mouse and touch run the same engine after #1922 deleted native HTML5 drag. Keyboard reaches the same actions on a focused row. Two sync races found in staging spans were closed in #1919 — a `409` on `PUT /queue/` used to adopt server state wholesale and discard the mutation whose toast had already fired, and even a `200`'s echo could clobber a mid-flight change. **next in this arc**: nate's pick for a like key (the obvious `l` collided with global next-track); whether the landing line needs more than a subtle underline now that displacement carries the signal; the swipe hint's `queue-swipe@1` is the first user of versioned one-time hints, and other mechanisms that moved recently could use them.

**downloads are a relationship dial** (#1824–#1858, August 13–14 — prod `2026.0813.195021` → `2026.0814.213524`, detail archived): a four-value per-artist policy (open / ask / supporters / off, defaulting to `ask` when the artist has a support link) covering single tracks and whole albums as worker-built cached zips, through one `download_refusal`/`download_key` pair that three endpoints and the UI's `downloadable` flag all derive from. **next in this arc**: the attested.network entitlement path (#1871) swapping in behind `viewer_is_supporter`, which the schema was deliberately kept ignorant of; per-track toggles and download counts; elevation tokens done holistically rather than as a one-page snowflake (#1835).

**the iOS lock-screen scrubber is the standing unknown** (#1860–#1870, August 15–16): ⏮/⏭ arrows, metadata, and times all work on a physical iPhone; the scrubber cannot be grabbed under any of five media-session recipes, while SoundCloud's web player scrubs in the same Safari. Everything after #1860 was reverted byte-for-byte because none of it changed on-device behavior — codec/range support, artwork MIME, and call churn are ruled out, and the simulator disagrees with the phone. **next in this arc**: the deciding experiment, which is a minimal page on a physical device or Web Inspector attached to one — not another recipe (#1870).

**the credential chain, closed one step at a time** (#1778–#1790, August 7–8): asking "what do these findings compose into" rather than "is each one severe" found the session cache writing decrypted OAuth tokens *and the DPoP private key* into an unauthenticated Redis, keyed by the bearer token itself. Four steps closed — ciphertext-only cache (#1783), developer-token-only `/rest` (#1784), redis password (#1786), vendors off the uploader-controlled endpoint (#1790) — each verified against the running system rather than the diff. **next in this arc**: the scan-integrity half of #1778 (a `did:web` track's bytes are still served fresh on every request, so a clean scan does not pin what listeners hear) and the transcoder's fail-open auth (#1780), both in known issues; and auditing what a *blob* contains rather than what a field is named.

**the catalog has a spatial surface** (#1766–#1768, August 4): `/atlas` is an unlisted pan/zoom map of every public track, positioned by CLAP-embedding similarity, with haiku-named regions, cover art at deep zoom, and click-to-play through the normal footer player. Rebuilt daily by a GitHub Actions workflow into the stats bucket and proxied at `GET /stats/atlas`. The legal pages were updated in the same window to say plainly that public audio is analyzed and that derived data may be published (#1769), with `terms_last_updated` bumped so existing users are re-prompted. **next in this arc**: a live-radio overlay, deep links, on-map search, and the question of whether the atlas should exist as an ATProto artifact rather than only a page — all deliberately out of v1.

**the player's structural problem is now written down** (#1757–#1762, August 3–4, plus `docs/research/2026-08-03-player-architecture.md`): four bugs in two days — a queue eaten by a stale seek handler, a jam left paused, a station on air and silent after a rapid flip, and server-side rotations teleporting mid-song — were all the same shape: work outliving the load it belonged to on one shared `<audio>` element, or a rotation rebuilt underneath a listener. 22 writers to `player.paused` across 4 files, mode as three unrelated flags, coordination by effect ordering. The research note surveys nine mature players (MPD, mpv, ExoPlayer, AVFoundation, vidstack, shaka, hls.js, feishin, jellyfin-web), which converge on single-funnel element ownership, per-load lifecycles, and explicit mode. **next in this arc**: load-session scoping, the first of five proposed adoptions; and any automated coverage at all for jam, which remains the least-exercised mode.

**radio has a live source** (#1741–#1750, July 30–31 — prod `2026.0730.225420`): the `firehose` station airs relay-eval's sonified atproto firehose live over HLS, modelled as *preemption* of the rotation rather than an entry in it — the loop's position is derived from wall-clock time, and an unbounded broadcast inside it would dissolve that. A broadcast carries its own cover and credits its source, a negative liveness report gets a second opinion from the playlist, and the broadcaster is CDN-fronted so 1000 listeners cost its origin ~5 req/s instead of ~255. It then spent a day on air and silent (#1749, #1750): the tune-in path trusted `canPlayType`, which lies in Chrome, and then awaited a module import inside the tap handler, which spends mobile's autoplay permission. **next in this arc**: the station has no recorded fallback while its segments stay unlisted (see known issues); opening preemption to other broadcasters is gated on moderation, since live audio cannot be fingerprinted before it airs — the design shape (advertisement vs. admission, after sister-radio's syndication write-up) is now captured in #1774.

**the firehose promises neither order nor delivery, and bytes need owners** (#1732–#1740, July 30 — prod `2026.0730.072900`, `.181756`): a repo's commit history was re-emitted upstream and ingest applied each replayed state as current, so commits are now ordered by repo `rev`, which survives re-delivery where jetstream's `time_us` cannot; then the same instance stopped delivering `fm.plyr.*` for 11 hours while still serving Bluesky profile events, so the consumer now rotates across twelve hosts and detects a host gone blind on *our* collections specifically. Separately, staged-upload cleanup had been deleting published tracks' audio — a content-hash `file_id` means re-uploading a file you already published stages the exact key it is served from. 20 tracks across 7 artists broken, 13 recovered; playback now falls back to the artist's PDS blob and the refcount covers every media column. **next in this arc**: ~~an alert~~ shipped (#1775, August 7 — the write-echo blackout alert plus a consumer-liveness heartbeat); schedule `audit_media_integrity.py`; give `_MEDIA_REFERENCES` awareness of `r2_url`.

**moderation: from inert labels to recorded decisions** (#1691–#1718, July 24–27 — prod `2026.0725.035625` → `2026.0728.043224`): `copyright-violation` de-lists instead of doing nothing; adult labels stopped gating permalinks; `LabelContext.LIST` vs `VIEW` keeps labels shaping discovery rather than destinations; and underneath all of it `moderation_events` carries the review queue, per-track overrides, the audit trail, and the source of public transparency posts from @moderation.plyr.fm. Published contact is now `help@plyr.fm` / `dmca@plyr.fm`, and rate limits are keyed per client rather than per site (#1716, #1718). August 8–9 sharpened what those decisions *mean*: `override_exclude` is curation, not removal, so it empties chosen surfaces (feeds, search, radio, atlas) and never a destination anyone navigated to (#1799), and radio and the atlas actually honor it now (#1797). **next in this arc**: triage the 18 queued subjects; merge or discard the transparency-post batching work parked on `feat/batched-transparency-posts` (six curation events currently mean six posts); per-actor authentication, which is what gates agent participation; then a proposed/applied split so an agent can propose a decision a human approves. The DMCA surface itself is still incomplete (see known issues).

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, #1876–#1905, epic #1384): private audio in an artist-owned permissioned space (never R2), credential-gated playback, and since August 22 an artist-named member list rather than owner-only — the `simplespace` member list on the artist's PDS decides, and plyr never stores membership: it asks the space host for a credential with the reader's session and holds that answer for the credential's lifetime (a refusal for five minutes), so a change the artist makes from any client is honored without plyr in the loop (August 23). Every sign-in now requests the private-media permission set and a spaces PDS expands it into `space:` grants at consent, so the *grant* is the capability signal (advertised `scopes_supported` never listed the dynamic scopes and hid the feature from the official alpha PDS). **open**: the cross-account e2e leg needs its `ALPHA_TEST_*` secrets; membership and supporter standing stay separate facts by design; downloads of private tracks are still refused for everyone, owner included, until a private download byte path exists. Design: `docs/internal/architecture/private-media-access-list.md`. the wire contract is the spaces-alpha lexicons at the tip of atproto's `permissioned-data` branch, with Bulletin as the reference client; zds tracks that branch and has rejected stale bodies twice (#1656, #1876), so drift there shows up as a failed first private upload. The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md`.

**identity, discovery and the queue** (#1620–#1730, July): a broken avatar led to five live artists hidden from every discovery surface because we read one host's `#account` event as a statement about the person — fixed at three levels, and the identity task that maintains the PDS cache is now actually registered with the worker (it had never run in production). The radio no longer plays one artist back-to-back (#1730). An experimental subsonic `/rest` shim lets off-the-shelf clients (Symfonium, Amperfy, Shelv) play plyr libraries with a developer token as the password (#1644–#1651); collection continuity queues the rest of an album or playlist as a labeled "next from" context (#1626); repeat-one shipped (#1653/#1654/#1657), reviving @AilaScott's #1518, with repeat-all deferred until the loop-vs-continuation interaction is designed.

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues
- **66 production tracks lost their PDS blob to the edit bug** (#1904 fixed the bug, August 22): every metadata edit rebuilt the PDS record without `audioBlob`, so the PDS garbage-collected the blob and jetstream mirrored the blob-less record back. 21 artists affected since March 18; the audio still exists in R2. Repairing means re-uploading and rewriting records on other people's behalf, so it is **deliberately not done** — it waits on nate's call about consent (heads-up post or opt-in). affected rows: `audio_storage='r2' AND pds_blob_size IS NOT NULL AND pds_blob_cid IS NULL`.
- **non-web-playable uploads wait ~5 minutes to become playable in Chrome/Firefox** ([#1932](https://github.com/zzstoatzz/plyr.fm/issues/1932), [#1933](https://github.com/zzstoatzz/plyr.fm/issues/1933)): the optimize task took 4m40s and 4m52s for two AIFF uploads on August 24, ~90s of which is streaming the source out of R2 before ffmpeg starts, and the "new track" DM goes out at +3s — so a listener following the notification lands on the greyed state #1934 added rather than a player. defer the DM for `is_optimizing` tracks until the swap lands, and profile the R2→disk stream.
- **the revised private-media permission set is a re-consent event** (#1898): the `authority: "*"` reader permission only takes effect for sessions that consented after it was published, so a member added before their next sign-in cannot mint a credential yet. Credentials also live two hours by protocol with no revocation, so removal from a member list is eventual.
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

this is a living document. last updated 2026-08-24 (**a processing track looks processing before you press play**. #1934 surfaces the interim-rendition state on rows, cards and the track page instead of only toasting on click, after woody's AIFF upload sat unplayable in Chrome for ~4.5 minutes; the delay itself is now two issues (#1932 notification timing, #1933 the 90s R2→disk stream). also opened eurosky-social/eurosky-social-app#199 so mu.social renders plyr album and playlist links as inline players.) previously 2026-08-23 (**status maintenance for the August 17–23 window**. Archived the August 14–22 detail to `.status_history/2026-08.md` — the private-media access-list arc, the first-click comment-timestamp seek, the iOS scrub unwind, the comments panel, and the download policy — taking STATUS.md from 719 lines to ~460, and trimmed this trailer, whose older entries now live in the same archive file. Rewrote current focus around the two arcs that are actually live: the queue as a direct-manipulation surface, and private media now that it has a member list rather than an owner. Corrected the queue entries' dates, which were a day or two ahead of the merges they describe. Two new known issues recorded rather than left in a PR body: the 66 production tracks whose PDS blobs the edit bug deleted, which nobody has decided how to repair, and the re-consent the revised permission set requires of existing sessions. Recorded the podcast recap for August 17–23.) previously 2026-08-21 (**the createSpace body drifted from the spaces-alpha lexicons**. zds moved to the alpha lexicons on August 20 and rejected plyr's pre-alpha `createSpace` body, failing every first private upload on pds.zat.dev; #1877 sends the alpha body and lets `listRepos`/`listRepoOps` page by cursor, #1878 deletes the now-dead pre-DPoP Bearer bridge from #1856. verified old-vs-new body directly against zds, the smoke script, and the live private-media integration in CI; no user impact since prod has zero private tracks. the architecture doc now names the branch-tip lexicons and Bulletin as the contract, and the entry records how plyr's proxying client compares to Bulletin's syncing service.) previously last updated 2026-08-17 (**status maintenance for the August 9–17 window**. Archived the August 3–14 detail block to `.status_history/2026-08.md`, taking STATUS.md from 916 lines to ~410 — the credential chain, the `file_id` storage-key family, the media-bucket CORS policy, the upload memory wedge, and the whole track/album download build-out are now history rather than current state, kept as a single dated cross-reference. Rewrote current focus around the two arcs that are actually live: downloads as a per-artist relationship dial with the redrawn track page and non-modal comments panel around it, and the iOS lock-screen scrubber, which remains unexplained after five media-session recipes and a byte-for-byte revert to #1860. Left the known-issues list intact — nothing in it was retired by this window. Recorded the podcast recap for August 9–17.) previously last updated 2026-08-14 (**albums download as cached zips**. #1836 extends yesterday's download policy to albums — same shared `download_refusal`/`download_key`, zip built on the worker via the export machinery, cached in R2 under a digest of the ordered member keys so edits invalidate naturally, CDN-served by redirect; verified cold-build → SSE → zip → cache-hit on both staging and prod. #1834 brought the regrouped track page's mobile controls up to the 44px touch floor with press feedback on the play disc, punting the material treatment to #1835 rather than hardcoding a token-less one-off. #1837/#1838 fixed the brutal cold-download toast and captured the research as a `toast-copy` skill; #1839 caught the settings copy and docs.plyr.fm up to the feature. also: a 10-day orphaned vite on port 5199 had been silently absorbing every local dev-server start.)
