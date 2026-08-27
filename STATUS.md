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

#### two field reports, zero plyr bugs (August 27 — no code change)

**why**: two user reports arrived the same day and both initially read as
plyr defects — a fresh upload that "seemed unlisted", and a track whose
player showed `NaN:NaN` duration with no cover art. Both were run to
ground; neither was ours, and the evidence is worth keeping.

**what was found**:
- *the "unlisted" upload*: a ~300MB wav took ~4 minutes between
  `POST /tracks/` starting and the track row existing. During that window
  the track is invisible everywhere, which reads as a failed upload to the
  uploader and as "unlisted" to anyone checking. Verified end-state was
  fully public: DB row, PDS record, API `unlisted: false`, first item in
  the public feed. The confusion is the same family as #1932/#1934 —
  long processing windows with thin feedback — but on the *transfer*
  side rather than transcode; worth checking what the upload toast shows
  during the finalize window before filing anything new.
- *the `NaN:NaN` player*: one listener's media requests were 100% 5xx
  while everyone else was fine — because every 5xx on `audio.plyr.fm` /
  `images.plyr.fm` came from exactly one Cloudflare colo (JAX,
  Jacksonville FL): 63/63 requests 500/502 with `cf-cache-status: BYPASS`
  since ~17:00Z, zero 5xx from any other colo, while other colos served
  the same objects as cache HITs. Cloudflare's status page showed no
  incident, no JAX maintenance, component "operational" — a reminder that
  single-PoP faults go unacknowledged and the zone's own GraphQL
  analytics (`httpRequestsAdaptiveGroups` grouped by `coloCode`) are the
  real instrument. Diagnostic anchor if it recurs: a user's `cf-ray`
  suffix names the colo.

**technical notes**: the failure split is diagnostic by itself —
`api.plyr.fm` (Fly) worked while both R2 custom domains (Cloudflare)
failed, so pages rendered with dead media. "Works for us, fails for one
user across all their browsers" pointed at their machine until the
devtools screenshot showed the 500 was *server: cloudflare*; the colo
dimension settled it in one query.

#### supporter gating learns attested.network payments (#1936, #1938, #1939, August 25–26 — prod `2026.0826.054059`)

**why**: supporter-gated content only recognized atprotofans, a near-dormant
service (~1 supporter record/month network-wide). [atmosphere.money](https://atmosphere.money)
(ATM) is a live payments broker implementing the attested.network spec —
861+ payer records across ~69 DIDs — and after the first call with Joe
(8/25) the integration boundary is settled: ATM's hosted checkout owns the
payer OAuth relationship and writes the payer record; plyr reads and
respects attestations, writes no payment records, and holds no
payments-scoped credential. position: `docs/internal/research/2026-08-25-plyr-atm-position.md`;
plan: `docs/internal/research/2026-08-26-atm-integration-plan.md`; design #1871, stance #1722.

**what shipped**: `validate_supporter` moved to a neutral choke point
(`backend/_internal/supporters.py`) that owns the per-pair redis cache and
checks, in order: attested.network payment attestations, then atprotofans.
The attested branch reads `network.attested.payment.{oneTime,recurring}`
from the viewer's own PDS, filters `subject` = artist DID, and accepts a
record only when its signatures strongRef resolves to a
`network.attested.payment.proof` at the same rkey in a trusted broker's
repo (settings allowlist, seeded with broker.atmosphere.money) whose actual
CID matches the strongRef and whose status is "verified". The whole chain is
bounded by a 10s deadline so a slow PDS can't hang a play. Cross-app
support — e.g. a Supper subscription — now unlocks supporter-gated
streams/downloads in plyr with zero ATM registration.

**technical notes**:
- verified against live records: broker proofs do **not** pin the payer
  record's current content (0/7 sampled proofs match any recomputable CID of
  the record), so mutable payer fields — including `subject` — are taken on
  the payer's word; forging support still requires one real broker-verified
  payment to someone. flagged as a question for ATM.
- probing found `network.attested.payment.lookup?payer&recipient` is
  **public and unauthenticated** on both ATM hosts and returns full payment
  objects from ATM's canonical view — a candidate simpler verification
  branch once its record-policy semantics and stability are confirmed.
  `checkout.atmosphere.money` hosts the rest of the surface
  (`getPayoutStatus`, `requestRecipientApproval`, `listSubscriptions`,
  checkout procedures); the appview implements almost nothing.
- private-record-policy payments never appear in repo reads — correct per
  spec, not a gap. recurring records have no liveness check until ATM
  events exist (phase 1+).

**next**: Joe allowlists plyr's DID (~end of week; breaking API changes
expected first), then phase 1 of the plan — app registration, webhook
receiver with delivery-id dedupe, service-auth XRPC client.

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

#### plyr never stores membership — access is the space credential (#1930, August 23)

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

#### the queue became a direct-manipulation surface (#1904, #1907–#1924, August 22–23 — prod)

See `.status_history/2026-08.md` for detailed history: swipe-to-like /
swipe-to-remove and the anti-slop oxlint sweep across 91 files
(#1907–#1912), keyboard actions on rows, toasts in the app's glass, two queue
sync races diagnosed from staging spans, and the unified mouse/touch reorder
engine that deleted native HTML5 drag (#1914–#1922), plus the three matching
header buttons (#1924). Also archived: **editing a track deleted its audio from
the PDS** (#1904) — every metadata edit rebuilt the record without `audioBlob`,
the PDS garbage-collected the blob, and jetstream mirrored the blob-less record
back; the 66-track blast radius stays in known issues.

#### private media grows an access list (#1876–#1905, August 21–22 — prod `2026.0821.071650` → `2026.0822.185531`)

See `.status_history/2026-08.md` for detailed history: the spaces-alpha
contract catch-up after zds rejected plyr's pre-alpha `createSpace` body
(#1876–#1878), the grant rather than advertised `scopes_supported` as the
capability signal (#1881, #1885, #1891, #1903), the `simplespace` member list
on the artist's PDS becoming the source of truth (#1897–#1901, #1905), and
verification against the official alpha PDS plus Playwright e2e on every merge
(#1887–#1889). Design:
`docs/internal/architecture/private-media-access-list.md`.

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

**supporter standing is becoming a network fact, not a vendor's answer** (#1936, #1938, #1939, August 25–26 — prod `2026.0826.054059`): supporter gating recognized only atprotofans, which sees roughly one supporter record a month network-wide. attested.network — the spec ATM implements, with 861+ payer records across ~69 DIDs — is where the payments actually are, and phase 0 now reads them: `validate_supporter` sits at a neutral choke point (`_internal/supporters.py`) that owns the per-pair redis cache and tries attestations before atprotofans. The boundary with ATM is settled and deliberately lopsided — their hosted checkout owns the payer's OAuth relationship and writes the payer record; plyr only reads, and holds no payments-scoped credential of its own. **next in this arc**: Joe allowlists plyr's DID (~end of the week, after breaking API changes), then phase 1 — app registration, a webhook receiver with delivery-id dedupe, and a service-auth XRPC client. Two questions go with it: broker proofs don't pin the payer record's current content, so `subject` is the payer's word; and `payment.lookup` is public and unauthenticated, which may make the whole repo-walk unnecessary.

**the queue became a direct-manipulation surface** (#1907–#1924, August 23 — prod, mostly frontend-only promotes): a queue row now has exactly two pointer grammars, partitioned by one bias constant — horizontal is swipe (right likes, left removes, and swipe is now the *only* remove), vertical is reorder. The reorder engine measures rows once at pickup into a pure, unit-tested plan, lifts the dragged row under a real shadow, displaces neighbours iOS-home-screen style, and marks the landing gap with an accent line; mouse and touch run the same engine after #1922 deleted native HTML5 drag. Keyboard reaches the same actions on a focused row. Two sync races found in staging spans were closed in #1919 — a `409` on `PUT /queue/` used to adopt server state wholesale and discard the mutation whose toast had already fired, and even a `200`'s echo could clobber a mid-flight change. **next in this arc**: nate's pick for a like key (the obvious `l` collided with global next-track); whether the landing line needs more than a subtle underline now that displacement carries the signal; the swipe hint's `queue-swipe@1` is the first user of versioned one-time hints, and other mechanisms that moved recently could use them.

**downloads are a relationship dial** (#1824–#1858, August 13–14 — prod `2026.0813.195021` → `2026.0814.213524`, detail archived): a four-value per-artist policy (open / ask / supporters / off, defaulting to `ask` when the artist has a support link) covering single tracks and whole albums as worker-built cached zips, through one `download_refusal`/`download_key` pair that three endpoints and the UI's `downloadable` flag all derive from. **next in this arc**: ~~the attested.network entitlement path (#1871) swapping in behind `viewer_is_supporter`~~ — shipped August 26 as #1939 (see above), exactly the swap the schema was kept ignorant of; per-track toggles and download counts; elevation tokens done holistically rather than as a one-page snowflake (#1835).

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
- **Cloudflare's JAX colo serves 100% 5xx for the R2 media domains** (observed August 27, ~17:00Z onward): users routed to Jacksonville get 500/502 on `audio.plyr.fm`/`images.plyr.fm` while every other colo is healthy — player shows `NaN:NaN`, artwork missing, page otherwise fine. Nothing to fix on our side; unacknowledged on cloudflarestatus.com. If it persists, escalate to Cloudflare support with a ray ID from an affected user (`a31cbef0bed07221-JAX`), the zone, and the colo-scoped analytics. Remove this entry once the 5xx count at JAX drains.
- **a broker proof does not pin the payer record it signs** (#1939, observed August 26): across 7 sampled live attestations, the proof's inner `cid` matches no recomputable CID of the payer record's current content, with or without `signatures`. So verification pins the *proof* and trusts the broker's `verified` status, while mutable payer fields — including `subject`, the artist being supported — are taken on the payer's word. Forging supporter standing for an arbitrary artist still costs one real broker-verified payment to someone, which is why this shipped rather than blocked. Queued as a question for ATM; if the answer is "proofs aren't meant to pin content", the public `network.attested.payment.lookup` endpoint is the better branch anyway.
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
- UX for text-forward audio — declare a track as a reading/audiobook/podcast, link the source text, transcript as accessibility (user request, August 27; tags + description cover it functionally today)
- community-contributed audio for text posts — writer opts in, a reader records, writer approves; plyr's part is only a track record referencing an external text record, the approval/surfacing UX belongs to text-side clients (August 27)
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

this is a living document. last updated 2026-08-27 (**two field reports, zero plyr bugs**. a ~300MB wav's multi-minute transfer window read as a failed/unlisted upload — end-state verified fully public, no defect; and one listener's dead player traced to Cloudflare's JAX colo serving 100% 5xx on the R2 media domains while every other colo was healthy and the status page said nothing — recorded as a known issue with the ray ID and the colo-scoped analytics recipe. two backlog items captured from the same conversations: text-forward audio UX and community-contributed audio for text posts.) previously 2026-08-26 (**status maintenance for the August 23–26 window**. Archived the August 21–23 detail to `.status_history/2026-08.md` — the whole queue direct-manipulation arc (#1907–#1924), the metadata edit that deleted a track's audio from its PDS (#1904), and the private-media access-list build-out (#1876–#1905) — taking STATUS.md from 568 lines to ~445, and trimmed this trailer, whose older entries now live in the same archive file. Reordered the remaining August 23 entries so #1930 sits above the queue arc it postdates, and gave it its PR number. Rewrote current focus to lead with the arc that is actually live: supporter standing moving off atprotofans and onto attested.network attestations, with the ATM boundary settled and phase 1 waiting on an allowlist. Retired the downloads arc's 'next' item, since #1939 is exactly the entitlement swap it was waiting for. One new known issue recorded rather than left in a PR body: a broker proof does not pin the payer record it signs, so `subject` is the payer's word. Recorded the podcast recap for August 23–26.) previously 2026-08-26 (**supporter gating learns attested.network payments**. the plyr × ATM arc went from first call to production in two days: position doc #1936 and integration plan #1938 settle the boundary — ATM's checkout owns the payer OAuth and writes the payer record, plyr reads/respects and never holds a payments-write credential — and #1939 ships phase 0, a neutral `validate_supporter` choke point that verifies attested.network payer records against trusted-broker proofs ahead of the atprotofans branch, released as `2026.0826.054059`. live-data spike found broker proofs don't pin payer-record content and that ATM's `payment.lookup` is public — both queued as questions for Joe ahead of the allowlist.) previously 2026-08-24 (**a processing track looks processing before you press play**. #1934 surfaces the interim-rendition state on rows, cards and the track page instead of only toasting on click, after woody's AIFF upload sat unplayable in Chrome for ~4.5 minutes; the delay itself is now two issues (#1932 notification timing, #1933 the 90s R2→disk stream). also opened eurosky-social/eurosky-social-app#199 so mu.social renders plyr album and playlist links as inline players.) previously 2026-08-23 (**status maintenance for the August 17–23 window**. Archived the August 14–22 detail to `.status_history/2026-08.md` — the private-media access-list arc, the first-click comment-timestamp seek, the iOS scrub unwind, the comments panel, and the download policy — taking STATUS.md from 719 lines to ~460, and trimmed this trailer, whose older entries now live in the same archive file. Rewrote current focus around the two arcs that are actually live: the queue as a direct-manipulation surface, and private media now that it has a member list rather than an owner. Corrected the queue entries' dates, which were a day or two ahead of the merges they describe. Two new known issues recorded rather than left in a PR body: the 66 production tracks whose PDS blobs the edit bug deleted, which nobody has decided how to repair, and the re-consent the revised permission set requires of existing sessions. Recorded the podcast recap for August 17–23.) previously 2026-08-21 (**the createSpace body drifted from the spaces-alpha lexicons**. zds moved to the alpha lexicons on August 20 and rejected plyr's pre-alpha `createSpace` body, failing every first private upload on pds.zat.dev; #1877 sends the alpha body and lets `listRepos`/`listRepoOps` page by cursor, #1878 deletes the now-dead pre-DPoP Bearer bridge from #1856. verified old-vs-new body directly against zds, the smoke script, and the live private-media integration in CI; no user impact since prod has zero private tracks. the architecture doc now names the branch-tip lexicons and Bulletin as the contract, and the entry records how plyr's proxying client compares to Bulletin's syncing service.) earlier entries are preserved in `.status_history/2026-08.md`.
