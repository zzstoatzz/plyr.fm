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

### September 2026

#### the weekly status run learned where a PR actually lands, then learned to read the atmosphere (#2008–#2016, September 4–5 — workflow and docs on main; no production release carries them)

**why**: the run that maintains this file only knew which PRs had merged
since the last one, so its transcript called merges to main "shipped" and
never named a production release. merging is not shipping here: a
backend release is a tag, and a frontend-only release is a bare branch
push with no GitHub workflow at all, so a Cloudflare Pages deployment of
`production-fe` is its only record.

**what the report is** (#2008): `scripts/status_window.py` computes the
window from the last maintenance *merge* and reports, per PR, where it
landed — `prod via release <tag>`, `prod via frontend promote <time>`,
`staging only`, `docs only` — alongside the releases and Pages promotes in
the window, the plyr.fm account's public posts, and the arcs already in
`.status_history/`. docs: `docs/internal/tools/status-maintenance.md`.

**three runs to make the report true**: the first live run had no
Cloudflare credential, so #2009 saw no promotes and re-dated #2001–#2004 to
the later backend release. the reason was invisible because the script ran
inside the Claude step, whose tool output never reaches the job log — so
#2010 moved it to its own plain step that prints, scoped the Cloudflare
secrets to that step, and added a `report_only` dispatch that previews a
window with no Claude run. that made the actual fault readable: the Pages
deployments endpoint caps `per_page` at 25 and answers 400 above it
(#2011). #2012 put the promote dates back.

**then the run got context, and a trace of itself**: #2013 gave the run the
pub-search MCP server — long-form writing across leaflet, pckt, offprint,
greengale, whitewind and independent sites — because changes here are
usually precipitated by changes in the atmosphere that surface as writing
first, and named the model (`claude-opus-5`) in every maintenance PR
instead of hiding behind the `opus` alias. #2014 added a `window_since`
input for reruns and evaluations against a past window, and started
publishing the window report, the ecosystem context and the transcript to
the job summary and a run-id artifact — a run that judges "no maintenance
needed" opens no PR, and the PR body had been the only place any of it
landed. #2015 kept the action's execution file with those outputs, since
two silent runs had left nothing at all to read. that file then showed why
(#2016): the research subagent was launched in the background, the writer
edited STATUS.md meanwhile and ended its turn waiting on it, and the
session closed with no `ecosystem_context.md`. research is now its own
step before the writer, searching one call at a time with a retry on 502 —
a parallel burst made pub-search answer 502 on roughly a quarter of calls.

**this run is the first with all of it**: a given window (September 2 07:43Z
→ September 5 01:37Z, so it re-covers arcs already written up here), a
report whose promote column is populated, and an ecosystem pass whose
findings are folded into the entries below.

#### September 1–3 (archived)

See `.status_history/2026-09.md` for detailed history:

- **the footer became spotify's, then the only footer** (#1987–#2004,
  September 2–3 — GA in prod `2026.0902.232901`; the phone follow-ups
  #2001–#2004 as frontend-only promotes on September 3, 00:13Z and 00:54Z)
  — one layout, one style block: the classic footer, the `stacked`/`stage`
  props and the `skip-buttons` flag are deleted, and the floating queue
  button with them. the heart is the add menu (like, or add to a playlist)
  reading through the like owner in `lib/likes.svelte.ts`; the phone sheet
  is portaled to `body` past the footer's backdrop-filter, which cost two
  corrections — the lesson being to judge inside/outside clicks by
  `composedPath()`, not the target's ancestors. announced with a video post
  on September 3, whose reply names what is still wanted: gestures to remove
  or like from the queue, an ambient queue hydrated by For You, better
  reorder animations.
- **the ingest-blackout alert fired on a sign-up, and quiet-window rotation
  is gone** (#2006, September 3 — prod `2026.0903.222140`) — a sign-up's
  profile `create` was never in the dispatch table and a like arrived from a
  DID the consumer would not learn about for five minutes, so the echo
  signal had two permanent holes. host rotation now needs evidence: redis
  carries the time of plyr's latest own-namespace write, and the consumer
  rotates only when that write goes unechoed past a 120 s grace, rewinding
  the cursor to before it. no data was lost — the API writes the database
  before the PDS.
- **skip buttons, drawn until they were right** (#1958–#1966, September 1–2)
  — ±5/10/15 s buttons behind the `skip-buttons` flag, the step following
  track length through one ladder in `lib/skip-step.ts`, and four passes on
  the glyph (a chevron tip reads as a hook at 24 px; an svg inherits its font
  from the `<button>`, and georgia's old-style figures need `lining-nums`).
  the flag died with #2000; the rule survives — judge an icon as a drawing,
  at the largest size and the shipped size, in the row it lives in.
- **passing comments became a stack that reads the page** (#1968–#1980,
  September 2) — bubbles stack toast-style instead of replacing each other,
  placement measures the free bands above and below the trigger's row from
  the DOM and caps the stack to what fits, docking at the player is the last
  resort, and the motion settled at one breath after "really corny and heavy
  handed". ten PRs, five of them corrections to the one before, each found by
  replaying a five-comment burst on staging after the merge.
- **the upload form shows what it knows about the file** (#1954, prod
  `2026.0901.203801`) — choosing a file mounts an `AudioPreview` card: name,
  `m4a · 88 MB · 1:02:14`, a waveform, play/pause with seek, all read locally.
  the waveform has a measured cap because chromium spends ~100 MB of transient
  memory per audio minute in `decodeAudioData`. as first shipped it began the
  transfer on selection; #1957 moved it back to submit — plyr holds nothing
  until you say so.
- **the notification bot survives a revoked Bluesky session** (#1953, prod
  `2026.0901.203801`) — session errors are classified by exception type now,
  with one re-login and retry; the old string match on `"auth"`/`"401"` never
  saw `ExpiredToken: Token has been revoked`. transient failures still have no
  retry path (known issues).
- **a passing comment no longer hides under the player** (#1962, prod
  `2026.0902.045540`) — superseded within a day by the measured-band stack.

### August 2026

See `.status_history/2026-08.md` for detailed history:

- **client-side writes, phase 0 — shipped August 31, reverted September 1**
  (#1948–#1950, #1952) — the frontend became a second OAuth client and chained
  its consent after the cookie login, so every sign-in showed two authorization
  screens for a scope nothing used yet. the plan
  (`docs/plans/2026-08-31-client-side-writes.md`) stays as the direction; its
  sign-in section must be redesigned before any phase ships.
- **uploads became resumable sessions, and "slow" stopped meaning "dead"**
  (#1947, August 29 — prod `2026.0901.065150`) — an R2 multipart session with
  10 MiB parts, stall timeouts and retries, and a worker phase that settles the
  staged bytes; woody's 391–579s uploads had been called failures by a fixed
  300s client timeout. docs: `docs/internal/backend/resumable-uploads.md`. the
  field reports around it (#1943) were an upload failing before it sent, a
  transfer window read as a failure, and Cloudflare's JAX colo 5xx-ing the R2
  media domains.
- **supporter gating learns attested.network payments** (#1936, #1938, #1939)
  — a neutral `validate_supporter` choke point verifying attested.network payer
  records against trusted-broker proofs ahead of the atprotofans branch. ATM's
  checkout owns the payer OAuth; plyr reads and never holds a payments-write
  credential.
- **plyr never stores membership — access is the space credential** (#1930,
  August 23) — the `private_media_members` mirror depended on the artist
  opening their member list, so `_internal/private_access.py` now asks the
  artist's space host with the reader's own session and caches only that
  answer; table, model, mirror and reconcile deleted in `a81c2d9e4f07`. the
  contract catch-up that got there is #1876–#1905, design in
  `docs/internal/architecture/private-media-access-list.md`.
- **the queue became a direct-manipulation surface** (#1904, #1907–#1924,
  August 22–23) — swipe-to-like / swipe-to-remove, the anti-slop oxlint sweep
  across 91 files, keyboard actions on rows, two sync races found in staging
  spans, and the unified mouse/touch reorder engine that deleted native HTML5
  drag. Also **editing a track deleted its audio from the PDS** (#1904), whose
  66-track blast radius stays in known issues.
- **August 3–24** — a processing track looks processing before you press play
  (#1934); comment timestamps seek on the first click (#1873); the iOS
  lock-screen scrub unwind, reverted byte-for-byte (#1860–#1869, open as
  #1870); teal scrobbles on the production lexicons (#1823); the non-modal
  docked comments panel and the track page's redesign (#1843–#1855); downloads
  from a flag into a per-artist policy, albums as cached zips (#1824–#1842);
  the album batch that wedged the app VM on an aioboto3 default (#1831,
  #1832); the media hosts' missing CORS policy (#1821), which is also why the
  artwork accent wash was inert (#1753); `file_id` is not a storage key
  (#1805–#1811); the credential chain closed one step at a time (#1778–#1790);
  exclude as curation (#1797, #1799); search ranking lexical intent above
  trigram fuzz (#1801); `/atlas`, the 2D semantic map of the catalog
  (#1766–#1768); the redis password (#1786) and the blip that took the API down
  (#1787); three player bugs with one disease (#1757–#1762).

### November 2025 – July 2026

See `.status_history/` for detailed history, one file per month, `2025-11.md`
through `2026-07.md`. The arcs that used to sit under current focus — radio's
live source (#1741–#1750), firehose ordering (#1732–#1740), moderation's
recorded decisions (#1691–#1718), identity and discovery (#1620–#1730),
`/atlas` (#1766–#1768), the player-architecture note (#1757–#1762), downloads
as a relationship dial (#1824–#1858), and the queue as a direct-manipulation
surface (#1907–#1924) — are in `2026-09.md` with their open threads; anything
still live from them is in known issues.

## priorities

### current focus

**the player is spotify's footer now, for everyone** (#1987–#2004, September 2–3 — GA in prod `2026.0902.232901`, the phone follow-ups as frontend-only promotes on September 3): one layout — art, title, heart | shuffle, previous, ±skip, play, ±skip, next, repeat over a full-width scrubber | queue, volume — and on phones the compact bar plus a scrubber row that ends with the queue button; the floating queue button and the `skip-buttons` flag are gone. the heart is the add menu (like, or add to a playlist), reading through the like owner; the phone sheet rises from above the player. the passing-comment stack (#1968–#1980) and the drawn-icon rule (judge an icon as a drawing at the largest and the shipped size, in its row) stand. nate's standing instruction for this kind of iteration: promote to prod after the staging check without asking; design changes to the phone bar pause at staging for his eyes. **next**: the fungible `/now` page (the footer as its handle on phones, the queue moving there); whether skip handlers with `seekto` scrub on a real iPhone lock screen; the drawn-iconography idea (people draw plyr's icons, doodl-style, with published icon collections and an explore page) is parked as "soon, not now".

**records are moving into the client's hands — parked until the sign-in design is redone** (plan `docs/plans/2026-08-31-client-side-writes.md`; #1948–#1950 shipped in prod `2026.0901.065150`, reverted September 1 in #1952): phase 0 made the frontend a second OAuth client and chained its consent after the cookie login, so every sign-in showed two authorization screens. the direction stands — the file an artist uploads goes in their PDS as-is, plyr indexes/mirrors/serves, and the backend stops authoring records on anyone's behalf — but the next attempt must fit inside the single existing login, with scope growing only when a feature that needs it is used. two September write-ups are worth reading before phase 1: Keith's avatar builder (September 2) is the end state as a static site — a browser client asking for exactly two `repo:` collections and writing with `swapRecord` pinned to the CID it read, so a concurrent edit fails instead of clobbering — and HappyView's 2.14 notes (September 3) are the hazards on the way, where a second confidential client brought a refresh race that deleted sessions mid-flight and a logout that never called the PDS revocation endpoint. **next**: redesign how the browser gets a repo-write capability without a second flow, then phase 1 (likes).

**supporter standing is becoming a network fact, not a vendor's answer** (#1936, #1938, #1939, August 25–26 — prod `2026.0826.054059`): supporter gating recognized only atprotofans, which sees roughly one supporter record a month network-wide. attested.network — the spec ATM implements, with 861+ payer records across ~69 DIDs — is where the payments actually are, and phase 0 now reads them: `validate_supporter` sits at a neutral choke point (`_internal/supporters.py`) that owns the per-pair redis cache and tries attestations before atprotofans. The boundary with ATM is settled and deliberately lopsided — their hosted checkout owns the payer's OAuth relationship and writes the payer record; plyr only reads, and holds no payments-scoped credential of its own. **next in this arc**: Joe allowlists plyr's DID (~end of the week, after breaking API changes), then phase 1 — app registration, a webhook receiver with delivery-id dedupe, and a service-auth XRPC client. Two questions go with it: broker proofs don't pin the payer record's current content, so `subject` is the payer's word; and `payment.lookup` is public and unauthenticated, which may make the whole repo-walk unnecessary.

**the iOS lock-screen scrubber is the standing unknown** (#1860–#1870, August 15–16): ⏮/⏭ arrows, metadata, and times all work on a physical iPhone; the scrubber cannot be grabbed under any of five media-session recipes, while SoundCloud's web player scrubs in the same Safari. Everything after #1860 was reverted byte-for-byte because none of it changed on-device behavior — codec/range support, artwork MIME, and call churn are ruled out, and the simulator disagrees with the phone. **next in this arc**: the deciding experiment, which is a minimal page on a physical device or Web Inspector attached to one — not another recipe (#1870).

**the credential chain, closed one step at a time** (#1778–#1790, August 7–8): asking "what do these findings compose into" rather than "is each one severe" found the session cache writing decrypted OAuth tokens *and the DPoP private key* into an unauthenticated Redis, keyed by the bearer token itself. Four steps closed — ciphertext-only cache (#1783), developer-token-only `/rest` (#1784), redis password (#1786), vendors off the uploader-controlled endpoint (#1790) — each verified against the running system rather than the diff. **next in this arc**: the scan-integrity half of #1778 (a `did:web` track's bytes are still served fresh on every request, so a clean scan does not pin what listeners hear) and the transcoder's fail-open auth (#1780), both in known issues; and auditing what a *blob* contains rather than what a field is named.

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, #1876–#1905, epic #1384): private audio in an artist-owned permissioned space (never R2), credential-gated playback, and since August 22 an artist-named member list rather than owner-only — the `simplespace` member list on the artist's PDS decides, and plyr never stores membership: it asks the space host for a credential with the reader's session and holds that answer for the credential's lifetime (a refusal for five minutes), so a change the artist makes from any client is honored without plyr in the loop (August 23). Every sign-in now requests the private-media permission set and a spaces PDS expands it into `space:` grants at consent, so the *grant* is the capability signal (advertised `scopes_supported` never listed the dynamic scopes and hid the feature from the official alpha PDS). **open**: the cross-account e2e leg needs its `ALPHA_TEST_*` secrets; membership and supporter standing stay separate facts by design; downloads of private tracks are still refused for everyone, owner included, until a private download byte path exists. Design: `docs/internal/architecture/private-media-access-list.md`. the wire contract is the spaces-alpha lexicons at the tip of atproto's `permissioned-data` branch, with Bulletin as the reference client; zds tracks that branch and has rejected stale bodies twice (#1656, #1876), so drift there shows up as a failed first private upload. The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md`. Three groups wrote about this substrate in the September 2–5 window, and two things they say are worth holding onto: Cameron's reading of the spaces alpha (September 3) states plainly that spaces give access control but not confidentiality — data is unencrypted and readable by every member *and application* with access, and already-synchronized copies are not recalled by revocation, which is exactly what plyr's credential-lifetime-plus-five-minute-refusal answer does and does not cover; and Habitat (September 4) adopts a subset of `opensocial.community` where admins approve which apps may touch an org's spaces, because otherwise a malicious AppView can exfiltrate from people who never consented to it — the same client-attestation wire plyr already sends, plus an app-vetting layer plyr does not have. Roomy's Arbiter report (September 4) is the third: their answer to scopes being all-or-nothing on someone else's repo is to encode granularity in the NSID and carry a policy in the permission set, moving enforcement from the PDS to the XRPC server.

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues

- **Cloudflare's JAX colo serves 100% 5xx for the R2 media domains** (observed August 27, ~17:00Z onward): users routed to Jacksonville get 500/502 on `audio.plyr.fm`/`images.plyr.fm` while every other colo is healthy — player shows `NaN:NaN`, artwork missing, page otherwise fine. Nothing to fix on our side; unacknowledged on cloudflarestatus.com. If it persists, escalate to Cloudflare support with a ray ID from an affected user (`a31cbef0bed07221-JAX`), the zone, and the colo-scoped analytics. Remove this entry once the 5xx count at JAX drains.
- **a broker proof does not pin the payer record it signs** (#1939, observed August 26): across 7 sampled live attestations, the proof's inner `cid` matches no recomputable CID of the payer record's current content, with or without `signatures`. So verification pins the *proof* and trusts the broker's `verified` status, while mutable payer fields — including `subject`, the artist being supported — are taken on the payer's word. Forging supporter standing for an arbitrary artist still costs one real broker-verified payment to someone, which is why this shipped rather than blocked. Queued as a question for ATM; if the answer is "proofs aren't meant to pin content", the public `network.attested.payment.lookup` endpoint is the better branch anyway.
- **66 production tracks lost their PDS blob to the edit bug** (#1904 fixed the bug, August 22): every metadata edit rebuilt the PDS record without `audioBlob`, so the PDS garbage-collected the blob and jetstream mirrored the blob-less record back. 21 artists affected since March 18; the audio still exists in R2. Repairing means re-uploading and rewriting records on other people's behalf, so it is **deliberately not done** — it waits on nate's call about consent (heads-up post or opt-in). affected rows: `audio_storage='r2' AND pds_blob_size IS NOT NULL AND pds_blob_cid IS NULL`.
- **a DM that fails for a transient reason is never retried** (September 1): `_send_track_notification` correctly leaves `notification_sent` false when the send fails, but the only caller that would retry it is the Jetstream identity-update hook, which does not fire for an ordinary upload. track 1264's chat timeout on September 1 is a permanent miss; #1953 fixed the revoked-session case only. a scheduled sweep of un-notified tracks older than a few minutes is the missing piece.
- **non-web-playable uploads wait ~5 minutes to become playable in Chrome/Firefox** ([#1932](https://github.com/zzstoatzz/plyr.fm/issues/1932), [#1933](https://github.com/zzstoatzz/plyr.fm/issues/1933)): the optimize task took 4m40s and 4m52s for two AIFF uploads on August 24, ~90s of which is streaming the source out of R2 before ffmpeg starts, and the "new track" DM goes out at +3s — so a listener following the notification lands on the greyed state #1934 added rather than a player. defer the DM for `is_optimizing` tracks until the swap lands, and profile the R2→disk stream.
- **the revised private-media permission set is a re-consent event** (#1898): the `authority: "*"` reader permission only takes effect for sessions that consented after it was published, so a member added before their next sign-in cannot mint a credential yet. Credentials also live two hours by protocol with no revocation, so removal from a member list is eventual.
- **Logfire retention is shorter than time-to-report** ([#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)): on August 9 the project's earliest record was the same morning. A July 6 PDS-blob failure was therefore undiagnosable a month later — the DB row recorded *that* it failed, never why. Both the new mirroring alert and #1811's failure reasons are only worth as much as the window they survive in. Cheap mitigation for anything we may be asked about later: persist the reason next to the row, which outlives any retention setting.
- **the PDS picker offers tracks this deployment can't read** ([#1814](https://github.com/zzstoatzz/plyr.fm/issues/1814)): `pds_savable_count` checks ungated + no blob + not optimizing, none of which establishes that the bytes are reachable from here. After #1811 the failure is at least legible instead of a bare count, but the honest behavior is not to offer them. Both candidate fixes have an objection — a per-track HEAD is request-time I/O for a metadata endpoint, and an `r2_url`-origin heuristic reintroduces origin-sniffing right after #1805 removed it from the write path — so it wants a deliberate call. A third framing: if the record carries an `audioBlob`, mirror it in (#1778) rather than hide the track.
- **unlike may leave the track in the liked list** ([#1812](https://github.com/zzstoatzz/plyr.fm/issues/1812)): `test_cross_user_like` failed once against staging on August 9 and has passed since. Filed rather than dismissed as flaky, because the assertion describes a read-your-own-write guarantee. Ruled out: stale cache (the liked list is a direct DB query) and a failed delete (it commits before returning). Untested hypothesis: `unlike_track` deletes the row and backgrounds the PDS deletion, so a replayed like-create event could resurrect it — the #1736 family. Track deletes write a tombstone for exactly this reason; likes may have no equivalent.
- **`just backend test` runs serially, CI runs `-n auto`** ([#1815](https://github.com/zzstoatzz/plyr.fm/issues/1815)): the two take different paths through `conftest.py` — serial uses `_setup_database_direct` with no template database, no advisory lock, and no per-worker redis db. The entire parallel bootstrap only ever executed in CI, which is why #1809's bugs were invisible locally despite failing 5/5 once run CI's way. Distinct from the shared-compose-project issue below, which is about *concurrent* sessions rather than parallel workers.
- **pre-#1811 deletes orphaned R2 objects** ([#1367](https://github.com/zzstoatzz/plyr.fm/issues/1367)): track delete and account deletion keyed off `file_id`, so for firehose-ingested rows the delete was a silent no-op and the real object stayed in the bucket with nothing referencing it. Fixed going forward; anything already orphaned is still there. Production has only 5 ingested rows today so the historical blast radius is small, and the sweep that would confirm it is the audit #1367 already asks for.
- **a blind jetstream host permanently discards our events** ([#1796](https://github.com/zzstoatzz/plyr.fm/issues/1796)): rotation's fixed 10s cursor rewind cannot cover a blind window in which bsky traffic kept advancing the cursor (verified in production August 8 — see recent work). Silent loss for third-party-client writes, which the write-echo alert cannot see. Narrowed by #2006 (September 3): a rotation triggered by plyr's own unechoed write rewinds the cursor to before that write, so plyr's own records are replayed; foreign-client writes have no stamp, so a blind host still loses them and nothing rotates for them. The structural fix may be upstream rather than in our heuristics: jetstream v2's sealed archive with `planSnapshot` → replay → live cutover (zat's devlog 015, September 2) turns a missed window into a bounded replay, and LocalStack's September 3 write-up states the same delivery contract from the consumer side — advance the cursor only after a successful publish, expect inclusive at-least-once replay, dedupe on a stable key, and report an aged-out cursor rather than skipping past it. Worth checking whether the hosts we rotate through expose v2 replay before investing further in rotation.
- **parallel agent sessions share one test database** (found August 9): `backend/tests/docker-compose.yml` has no `name:` field, so compose derives the project name from the directory — every checkout/worktree of this repo maps to the same `tests-test-db-1`/`tests-test-redis-1` containers, and two sessions running tests concurrently silently recreate each other's schemas (see the #1801 technical notes for the evening this cost). A `name:` derived from the checkout path, or `COMPOSE_PROJECT_NAME`, would isolate them.
- **PDS-hosted audio is still scanned from a mutable source** ([#1778](https://github.com/zzstoatzz/plyr.fm/issues/1778), narrowed by #1790): the SSRF half is closed — `is_safe_url` now validates the endpoint where a miniDoc enters the system and at both `pds_blob_url` construction sites, and vendors are no longer pointed at the uploader-controlled URL. What remains is the scan-integrity half: a `did:web` track's bytes are served by the user's own host on every request, so a clean copyright scan does not pin what listeners later hear. Pinning the scan to `pds_blob_cid` means fetching and hashing blobs on the track-creation hook — the path #1519 deliberately made non-blocking — so it is a real change, not a validation tweak.
- **the transcoder's auth fails open** ([#1780](https://github.com/zzstoatzz/plyr.fm/issues/1780)): with `TRANSCODER_AUTH_TOKEN` unset it logs a warning and accepts every request, and the app has a public IP. Currently latent — the secret is set and the app is suspended — but `services/moderation/src/auth.rs` returns `SERVICE_UNAVAILABLE` in the same situation, so the transcoder is the outlier and this is a consistency fix.
- **CORS permits every HTTPS origin with credentials** (from #208, closed Feb 2026): `allow_origin_regex` resolves to `^(https://.+|http://localhost:\d+|null)$` with `allow_credentials=True`. Harmless today only because the session cookie is same-site and `SameSite=Lax` is carrying the entire defense — it would become a full CSRF-and-read hole the moment anyone sets `samesite="none"` for an embed, or moves the API off the `plyr.fm` registrable domain. #208's closing summary claimed "CORS validation" and its own item 1 (magic-byte MIME validation) never shipped; uploads still trust the client's `Content-Type`. Worth treating as a lesson about closing security issues against a summary rather than the running system.
- **staging's error-level `SELECT neondb` spans are benign and staying** (August 8; full diagnosis in `.status_history/2026-08.md`): staging's Neon compute suspends after 5 minutes idle while `pool_recycle` is 1800s, so the next checkout gets a dead connection and the OTel instrumentation stamps an `ERROR` span with no message. `pool_pre_ping` recovers transparently — all 95 traces had a succeeding root span. `DATABASE_POOL_RECYCLE=240` was tried and unset again: forcing a reconnect every 240s starved concurrent uploads behind the 3-per-artist gate and timed out three album integration tests. The correct fix, if it ever matters, is disabling scale-to-zero on the staging compute.
- **nothing records listening over time** (August 5 accounting; retention figure corrected August 9): `play_count` is a counter on the track row, so plays-per-day exists only inside Logfire's retention window — which is **far shorter than the 14 days assumed here**: on August 9 the earliest record in the project was the same day at 06:12 (see [#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)). The history before that is unrecoverable. Every day without an append-only play-events table (or a daily `/stats` snapshot) is another day of curve we cannot draw later. Deliberately not built yet — it is new surface, and the shape of it is undecided.
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
- **skip handlers together with `seekto` have never been on a physical iPhone** (#1958, September 1; now true for everyone since the #2000 GA, prod `2026.0902.232901`): `seekbackward`/`seekforward` are registered next to the existing `seekto`, a combination none of the #1860–#1869 recipes tried, and iOS shows ±skip in place of ⏮/⏭ because of it. whether the lock-screen scrubber behaves differently with both is nate's phone to answer — and the flag that used to limit the blast radius is gone.
- **the iOS lock-screen scrubber cannot be dragged in the real app** ([#1870](https://github.com/zzstoatzz/plyr.fm/issues/1870)): metadata, times, and ⏮/⏭ all work; the scrubber never grabs on a physical iPhone under any of five media-session recipes, while SoundCloud's web player scrubs in the same Safari. the deciding experiment — a minimal page on a physical phone, or Web Inspector attached to the device — has not run yet; the code is deliberately parked at the #1860 state.
- iOS PWA audio may hang on first play after backgrounding — independently corroborated outside plyr: coryd.dev's note on why he built a native Navidrome client says audio plays but never advances to the next track in Safari or a home-screen PWA, which puts continuous playback on the platform rather than on our queue code
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- the queue's own wishlist, from the September 3 post announcing it: swipe gestures for remove-from-queue and like on the queue rows, an ambient queue hydrated by For You rather than only refilled when it runs dry, and better reorder animations
- drawn iconography: let people draw plyr's own icons doodl-style — slottable icon components, published icon collections, an explore page for them (nate, September 1: "soon, not exactly now"; the sibling repo `doodl` is the reference: `tech.waow.doodl.iconset` maps UI slots to drawing strongRefs)
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

this is a living document. last updated 2026-09-05 (status maintenance over a given window, September 2 07:43Z – September 5 01:37Z, which re-covers arcs already written up here: the footer GA #1987–#2004 and the jetstream rotation rewrite #2006 moved to `.status_history/2026-09.md`, and the maintenance run's own arc #2008–#2016 written up in their place. one correction carried over from #2012 that this note had kept stating the old way: **#2001–#2004 reached prod as frontend-only promotes on September 3, 00:13Z and 00:54Z**, not as part of the backend release `2026.0903.222140`, which carried #2006. the first ecosystem pass ran this window, and its findings are folded into the client-side-writes and private-media entries under current focus and into the blind-host and iOS-PWA known issues.) earlier entries are preserved in `.status_history/`.
