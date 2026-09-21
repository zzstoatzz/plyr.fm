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

#### evergreen found four upload jobs the reaper could not see (#2084, #2085, #2087, September 21 — prod `2026.0921.055515`)

The new read-only `/health/freshness` probe reported four `pending`, phase-less
upload jobs stalled for 65–144 days. This was stale state, not a current ingest
outage: 20 uploads completed in the preceding week, one failed, and the newest
track published September 20. The database and optimization queues were healthy.

The probe checks database reachability plus upload and optimization progress and
returns 503 without mutating state. The upload reaper now claims stale `pending`
jobs that never entered transfer as well as stale `processing` jobs; it leaves
`pending/transfer` sessions to the separate 24-hour abandoned-transfer policy.
The first production run failed all four orphaned jobs, skipped R2 cleanup because
none had cleanup hints, and notified the two affected accounts. Freshness returned
200 afterward. Post-release spans had no 5xx or database errors; the label stream
closed during deployment, resumed from cursor 746, and reconnected 17 seconds
later.

The first operator DMs exposed a second problem: plain text made a repository
path look like a runbook link, raw URLs occupied whole lines, and "pipeline
stalled" would overstate what one abandoned job proves. Chat messages now carry
ATProto rich-text facets. Reaper alerts say that specific jobs stalled, identify
the environment, link affected accounts and live upload health, and lead to a
dedicated triage runbook while retaining full job IDs for search. Track,
copyright and user-report DMs use labeled track, artist and target links through
the same transport. There is deliberately no synthetic alert sent through the
shared moderation account and no job-detail link until such an operator surface
exists.

#### musician studio paused (September 20)

Nate paused the project after another production retry exhausted all four audio
review attempts with HTTP 503. Both continuous and legacy pilot deployments are
paused in Prefect, their schedules are inactive, and the three pending scheduled
runs were cancelled. The repository schedule also defaults to inactive. Saved
music, musician accounts, credentials and cost history remain intact. Resume
only after an explicit decision to restart the project.

#### the status podcast turned a host name into a category (track 1334, September 20)

the `status maintenance` run (#2080) voiced "users on self-hosted personal
data servers could never get audio onto their PDS". Its source says
`light777.selfhosted.social` — a provider, not a category — hit the DPoP
`ReadError`, one blacksky.app user matched, and every other PDS worked after
a wasted 401. Track 1334's description (the transcript) is corrected; the
audio is not. A maintenance PR's transcript is now read before merging.

#### bounded studio review truncation recovery (#2081, September 20)

The scheduled review retried two HTTP 503s, then stopped on `MAX_TOKENS` because
incomplete responses were all non-retryable. Audio tasks now distinguish explicit
truncation: the first request retains 1,600 tokens, and Prefect retries allow
4,096. Truncation at the larger limit still stops. Existing retry, request and
spend checks remain in force; paid truncated responses are charged. Diagnostics
include the requested limit. A Prefect regression verifies recovery, usage
accounting and reuse of the completed result without another paid request.

#### the upload pipeline as two writes and one promise (#2075, September 19 — prod `2026.0919.214851`)

**why**: garrison (@garrison.corporate.fm) posed an interview question on
September 18 — a database, an object store, uploads that can succeed without
answering; keep every reference valid, leave no bytes dangling — and then
published "Two writes, one promise", which reviewed this pipeline at `6bae695`
and named four windows. All four were real at head of main: cleanup hints
were saved *after* `promote_staged`; a worker paused past the reaper's
10-minute threshold could wake, publish a track and a PDS record against
bytes the reaper had just deleted, and mark the job completed;
`update_progress` and `heartbeat` wrote a `failed` job back to life; a failed
R2 delete was logged once and never retried.

**what shipped**: publication and abandonment compete on the job row.
`lock_for_publication` takes it `FOR UPDATE` inside the reservation
transaction and refuses a terminal job; the reaper claims with `SKIP LOCKED`
and commits before deleting, so whichever locks first decides. `completed`
and `failed` are terminal for progress and heartbeat writes. Hints are
written before bytes, so the failed job row *is* the tombstone:
`sweep_abandoned_uploads` (every 30 min) re-discards each failed upload's
media for 7 days through the refcounted `discard_staged`, skipping any key a
live job names in its hints. R2 delete on a missing key is `info`. Seven
real-path tests in `tests/api/test_upload_job_fence.py` fail on main. Smoked
on staging by hand; on prod the first sweep kept a key a live track still
references (refcount 1) and a tagged upload published through the fence.

**open**: a track that publishes while its worker stalls in the post-upload
hooks is real but its job stays `failed`, and the re-upload is rejected as a
duplicate; the 7-day window is an argument, not a proof. Next, from the same
essay and from garrison's XB: verify the promoted object (HEAD, expected size)
inside the publication step, a read-only inventory of `audio/`, a sweep on
`result.transfer`, and a generation on the job row. Full write-up in `.status_history/2026-09.md`.

#### studio failure diagnosis (#2076, September 19 — prod `2026.0919.214851`)

The September 19 18:17 study used its 12-request allowance after multiple audio
503 retries and a timeout. This was request exhaustion, not a new quota error.
The studio now reports `BudgetPaused` with actual request/spend totals, preserves
the reservation and progress artifact, and stops before publication if mandatory
reviews are unfinished. Closed or missing sessions still fail. Incomplete Gemini
responses retain finish/block reasons and output/thinking token counts without
logging response text. No retry, model, or budget limits were increased.

#### the PDS DPoP nonce was thrown away after every request (#2072, #2073, September 18–19 — prod `2026.0919.060731`, `2026.0919.214851`)

**why**: light777.selfhosted.social could not save a track's audio to their
PDS — `blob upload failed after 4 attempts: ReadError('')`, the signature a
blacksky.app user hit on September 9 — and a 1.7 MB wav reproduced it on
staging, so size was never the story. A PDS issues its DPoP nonce per server
and rotates it; plyr wrote the nonce into the session only at sign-in and
refresh, rebuilt the session from that row on every request, and the nonce
learned on a 401 retry went to a process-local store nothing read. Prod
Logfire showed roughly one 401 per 200 on every `com.atproto.repo.*` write.
Buffered writes paid a round trip; streamed audio was sent twice; a PDS that
rejects a stale nonce before reading the body closed the connection
mid-stream, so the fresh nonce was never read and every retry repeated it.

**what shipped**: `utilities/pds_nonce.py` keeps the latest nonce per PDS host
in Redis (10 min TTL), shared by API and worker; `reconstruct_oauth_session`
is async and prefers it; streamed uploads prime the nonce with a bodyless
signed `GET com.atproto.server.getSession` before each attempt (#2072); every
signed response's `DPoP-Nonce` is kept in both request paths, so the cache
fills without a 401 first (#2073). Prod smoke with `nate.selfhosted.social`:
prime 200 → `uploadBlob` 200 on the first attempt → `audio_storage=both`. The
nonce is deliberately not written to the session row — that would re-encrypt
it and invalidate the session cache on every request. blacksky.app is
unverified; there is no test account there.

#### a double-clicked upload, and what the red test suites were hiding (#2063–#2070, September 18 — prod `2026.0918.172630`, `2026.0918.214637`)

**why**: light777 clicked "upload track" twice 570 ms apart and got two
tracks and two PDS records for one 79 MB file: the form stayed live through
the preflight, and the duplicate check was a bare SELECT several phases
before the insert. Fixing it meant looking at CI, where both staging suites
had been failing for reasons nobody had read.

**what shipped**:
- `_create_records` takes an artist-scoped advisory lock and re-runs the
  duplicate query in the transaction that inserts the pending row; `/upload`
  ignores submits while one is in flight (#2063).
- `e2e private media` had been red on every push since #2049 (September 12,
  ten runs): a `getByLabel(…, { exact: true })` that cannot match a label
  wrapping its `<select>` (#2064), then a race with the deploys —
  `wait-for-staging.mjs` now blocks until the head of main's build is served,
  every `_app/immutable` asset it references returns 200, backend deploys
  have drained, and all of it holds for six consecutive samples (#2065,
  #2067). The html flips before the assets do.
- the integration suite surfaced two real races of one shape — the Jetstream
  echo of plyr's own PDS write beating the task that made it: unlike shortly
  after like resurrected the like for half a second (#2066 covered one
  ordering, #2069 makes every ordering converge by having both observers
  clean up); and when the echo finalized a pending upload first, mp3
  optimization was never scheduled, so ogg/aiff/wav stayed on the interim
  rendition (#2070). `published_by_us` now gates only run-once side effects.
  The suite's token mint retries three times (#2068).

light777's duplicate was left alone: they removed one copy from their album
within the hour, and the other has the play.

#### the queue's shared connection and revision are atomic (#2061, #2062, September 15–16 — prod `2026.0915.222459`, `2026.0916.001323`)

`QueueService` ran every request's NOTIFY and the 5 s heartbeat on one raw
asyncpg connection with nothing serializing them; asyncpg refuses a second
in-flight query, so overlapping queue PUTs lost their NOTIFY and other
instances served a stale queue for up to the 300 s TTL — six times in eight
minutes for one user on September 14. A service-owned lock now wraps every
execute (#2061). The load test written for it found `update_queue` bumping
the revision in Python (15 of 100 users lost an increment) and two first
writes racing the primary key; one `INSERT … ON CONFLICT DO UPDATE` with the
expected revision in the conflict WHERE does both (#2062).

#### musician uploads follow the publishing contract (#2060, September 14 — prod `2026.0915.222459`)

The September 14 Kite study passed its audio reviews but its upload was rejected
with `400: unknown upload fields: visibility`. #2049 replaced that legacy form
field with JSON `publishing`. The studio now sends an explicit per-track policy:
public listening, open downloads, unlisted visibility, no attached rights. AI
self-labels and post-upload visibility verification remain. All 72 studio tests
pass; the multipart regression fails on the prior request. The current backend
policy model accepts the request and gives it precedence over account defaults.
The failed study's upload reservation remains intact; it is not reset for retry.

#### September 5–14 (archived)

See `.status_history/2026-09.md` for the full write-ups:
- **publishing permissions are independent of storage** (#2047, #2049,
  #2052–#2058, September 12–14 — prod `2026.0913.023332` → `2026.0914.040530`,
  announced September 13): `PublishingPolicy` is three axes — listening,
  downloads, visibility — plus rights that no longer touch storage; defaults
  flow by snapshot from Portal → album → track; migration `311b4f106c90`
  snapshots 1,064 prod tracks and moves no bytes. #2056 streams private audio
  back to the PDS when restrictions lift; #2057 stops asking a Space for
  authority on every play of a non-Space track. "downloads off" is
  distribution control, not DRM.
- **three musicians who must listen before they publish** (#2031–#2051,
  September 6–12 — prod `2026.0907.200622` → `2026.0913.023332`): Moss, Kite
  and Reed compose every six hours in a sandboxed container; no upload without
  a native-audio self-review, a revision and a peer review of the exact
  rendered hash. No track has passed the full gate. Blind controls say the
  listener hears isolated events and wobbles on a mix.
- **agents on both sides of the API** (#2022–#2025, #2036, September 5–8):
  skills in `.agents/`, `plyr.fm/llms.txt` as the canonical guide with a
  contract check in pre-commit, and the robot glyph shown only for a
  self-applied `bot` label.
- **smaller things** (September 5–13): in-place track editing (#2030, #2045);
  suggested tags for PDS-hosted audio (#2034, #2035); interrupted PDS uploads
  close their streams (#2043); embeds caught up with the player (#2044); top
  tracks default to the past month (#2048).

#### September 1–5 (archived)

See `.status_history/2026-09.md` for the full write-ups:
- **the player's clipped "g" exposed a track-identity collision**
  (#2026–#2028, September 5): the queue now saves database track IDs beside
  the legacy file IDs; audio identity caches bytes, it is not a track's
  identity. design: `docs/internal/frontend/queue.md`.
- **the footer became spotify's, then became the only footer** (#1987–#2004,
  September 2–3 — GA in prod `2026.0902.232901`).
- **the ingest-blackout alert fired on a sign-up; quiet-window host rotation
  is gone** (#2006, September 3 — prod `2026.0903.222140`).
- **the status-maintenance run knows where things landed, reads the
  atmosphere, and runs on fable 5.1** (#2008–#2021, September 4–5); the
  September 14 run was the first full run of that process.
- **September 1–2**: skip buttons and the passing-comment stack, both
  superseded within days; the upload form's file preview (#1954, #1957) and
  the notification bot surviving a revoked session (#1953).

### August 2026

See `.status_history/2026-08.md` for detailed history. Headlines: client-side
writes phase 0 shipped August 31 and was reverted September 1 (#1948–#1952);
uploads became resumable sessions (#1947); supporter gating learned
attested.network (#1936–#1939); plyr never stores membership, access is the
space credential (#1930); the queue became a direct-manipulation surface
(#1907–#1924); editing a track deleted its PDS audio (#1904).

### November 2025 – July 2026

See `.status_history/`, one file per month, `2025-11.md` through `2026-07.md`.
The arcs that used to sit under current focus (radio's live source, firehose
ordering, moderation's recorded decisions, identity and discovery, `/atlas`,
the player-architecture note, downloads as a dial, the queue as a surface) are
in `2026-09.md` with their open threads; anything still live is in known issues.

## priorities

### current focus

**an upload is two writes and one promise** (#2063, #2070, #2075, September
18–19 — prod `2026.0918.172630` → `2026.0919.214851`): the job row now decides
whether an upload is alive, hints precede bytes, and a failed job's media is
re-swept for seven days. The same window closed three races of one shape —
the Jetstream echo of plyr's own PDS write beating the task that made it
(#2066, #2069, #2070) — and the double-submitted form (#2063). **next**, from
garrison's essay: verify the promoted object inside the publication step; a
read-only inventory of `audio/` against every media column; a sweep on
`result.transfer`; a compare-and-set finalize in `ingest_track_create` so the
post-create hooks cannot run twice (known issues); and, once a PDS nonce
problem is not the first suspect, a test account on blacksky.app.

**publishing permissions are independent of storage** (#2049, #2056, #2057):
Portal defaults, album application and per-track exceptions are in production.
Listening audience, downloads, discovery and rights metadata are separate choices.
Today “my Space members” also means private metadata; private R2 audio alone does
not hide a work. Future Space-backed storage must preserve those audience choices,
rather than turn every protected work into members-only content. Moving existing
works across Space boundaries remains a separate migration decision.

**three musicians, gated on listening** (#2031–#2051, September 6–12): Moss,
Kite and Reed compose every six hours on the home worker and may not upload
until a native-audio self-review, a revision, and a peer review of the exact
rendered hash exist. No track has passed the full gate yet: Kite's September 14
study passed its reviews and was refused by the publishing API (#2060, fixed);
the September 19 study exhausted its request allowance on audio 503 retries
and now reports `BudgetPaused` instead of a crash (#2076). The calibration
controls say the listener hears isolated events and wobbles on a mix. **next**:
a live calibration run in the evaluation window, a human ear on anything that
does get released, and whether the app-level `bot` label should point at a
machine-readable disclosure record like the one proposed on WhiteWind in
January.

**records are moving into the client's hands — parked until the sign-in design is redone** (plan `docs/plans/2026-08-31-client-side-writes.md`; #1948–#1950 shipped in prod `2026.0901.065150`, reverted September 1 in #1952): phase 0 made the frontend a second OAuth client and chained its consent after the cookie login, so every sign-in showed two authorization screens. the direction stands — the file an artist uploads goes in their PDS as-is, plyr indexes/mirrors/serves, and the backend stops authoring records on anyone's behalf — but the next attempt must fit inside the single existing login, with scope growing only when a feature that needs it is used. **next**: redesign how the browser gets a repo-write capability without a second flow, then phase 1 (likes).

the August arcs that sat here until September 20 — the spotify footer, supporter standing via attested.network, the iOS lock-screen scrubber, the credential chain — are in `.status_history/2026-09.md` under "priorities archived 2026-09-20"; their open threads are in known issues.

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, #1876–#1905, epic #1384): private audio in an artist-owned permissioned space (never R2), credential-gated playback, and since August 22 an artist-named member list rather than owner-only — the `simplespace` member list on the artist's PDS decides, and plyr never stores membership: it asks the space host for a credential with the reader's session and holds that answer for the credential's lifetime (a refusal for five minutes), so a change the artist makes from any client is honored without plyr in the loop (August 23). Every sign-in now requests the private-media permission set and a spaces PDS expands it into `space:` grants at consent, so the *grant* is the capability signal (advertised `scopes_supported` never listed the dynamic scopes and hid the feature from the official alpha PDS). **open**: the cross-account e2e leg needs its `ALPHA_TEST_*` secrets; membership and supporter standing stay separate facts by design; downloads of private tracks are still refused for everyone, owner included, until a private download byte path exists. Design: `docs/internal/architecture/private-media-access-list.md`. the wire contract is the spaces-alpha lexicons at the tip of atproto's `permissioned-data` branch, with Bulletin as the reference client; zds tracks that branch and has rejected stale bodies twice (#1656, #1876), so drift there shows up as a failed first private upload. The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md`.

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues

- **post-create hooks may run twice when the Jetstream echo and the upload task both finalize a track** (staging track 9392, September 18, unreproduced): `ingest_track_create` finalizes a pending row with a plain ORM write, not a compare-and-set, and the upload task's own `post-create hooks completed` landed 14 s after `ingest: finalized pending track` for the same row. The hooks send the notification DM and start the copyright scan. Written up in #2070.
- **a track that publishes while its worker stalls keeps a `failed` job** (#2075, intentional for now): the user is told "timed out — please re-upload" and the re-upload is rejected as a duplicate. Teaching the reaper to recognize the committed track row and complete the job is deferred.
- **PDS blob upload to blacksky.app is unverified after the nonce fix** (#2072): the September 9 failure there had the same `ReadError('')` signature as selfhosted.social, which the fix cleared in prod, but there is no test account on blacksky.
- **nothing alerts when a workflow on main is red**: `e2e private media` failed on ten consecutive pushes (September 12–18) before anyone looked. `gh run list --workflow "e2e private media"` is the check until there is one.
- **the cross-account member leg of the private-media e2e still skips**: `ALPHA_TEST_HANDLE`/`ALPHA_TEST_PASSWORD` are not set, so the flow that adds a second account to a Space and plays the track never runs in CI.
- **light777.selfhosted.social's duplicate track (1323/1324) is theirs to remove**: same `file_id`, one R2 object; the refcount guard keeps the audio when either row is deleted. `test_refcount_prevents_r2_deletion` covers it.
- **staging has two artist rows for `nate.selfhosted.social`**: `GET /artists/by-handle/…` and `GET /albums/…` 500 with `MultipleResultsFound` on staging; prod has one row.
- **browser private-media e2e stops at PDS sign-in** (September 13): runs
  [34767184692](https://github.com/zzstoatzz/plyr.fm/actions/runs/34767184692) and
  [34785740209](https://github.com/zzstoatzz/plyr.fm/actions/runs/34785740209)
  both timed out before upload or playback because the browser blocked the
  `pds.zat.dev` authorization form under `form-action 'self'`. This predates
  #2057. Authenticated API and actual Space blob smoke passed; they do not prove
  that browser sign-in/upload works. The CSP cause remains unresolved.
- **one artwork scan returned 400** (September 13, 18:33 UTC): track 1303's
  artwork saved and its CDN read returned 200, but the background request to
  the moderation service's `/scan-image` failed. The trace did not record the
  rejection reason. Neither successful artwork storage nor a completed task
  establishes that this image was scanned; diagnosis remains open.

- **Cloudflare's JAX colo serves 100% 5xx for the R2 media domains** (observed August 27, ~17:00Z onward): users routed to Jacksonville get 500/502 on `audio.plyr.fm`/`images.plyr.fm` while every other colo is healthy — player shows `NaN:NaN`, artwork missing, page otherwise fine. Nothing to fix on our side; unacknowledged on cloudflarestatus.com. If it persists, escalate to Cloudflare support with a ray ID from an affected user (`a31cbef0bed07221-JAX`), the zone, and the colo-scoped analytics. Remove this entry once the 5xx count at JAX drains.
- **a broker proof does not pin the payer record it signs** (#1939, observed August 26): across 7 sampled live attestations, the proof's inner `cid` matches no recomputable CID of the payer record's current content, with or without `signatures`. So verification pins the *proof* and trusts the broker's `verified` status, while mutable payer fields — including `subject`, the artist being supported — are taken on the payer's word. Forging supporter standing for an arbitrary artist still costs one real broker-verified payment to someone, which is why this shipped rather than blocked. Queued as a question for ATM; if the answer is "proofs aren't meant to pin content", the public `network.attested.payment.lookup` endpoint is the better branch anyway.
- **66 production tracks lost their PDS blob to the edit bug** (#1904 fixed the bug, August 22): every metadata edit rebuilt the PDS record without `audioBlob`, so the PDS garbage-collected the blob and jetstream mirrored the blob-less record back. 21 artists affected since March 18; the audio still exists in R2. Repairing means re-uploading and rewriting records on other people's behalf, so it is **deliberately not done** — it waits on nate's call about consent (heads-up post or opt-in). affected rows: `audio_storage='r2' AND pds_blob_size IS NOT NULL AND pds_blob_cid IS NULL`.
- **a DM that fails for a transient reason is never retried** (September 1): `_send_track_notification` correctly leaves `notification_sent` false when the send fails, but the only caller that would retry it is the Jetstream identity-update hook, which does not fire for an ordinary upload. track 1264's chat timeout on September 1 is a permanent miss; #1953 fixed the revoked-session case only. a scheduled sweep of un-notified tracks older than a few minutes is the missing piece.
- **non-web-playable uploads wait ~5 minutes to become playable in Chrome/Firefox** ([#1932](https://github.com/zzstoatzz/plyr.fm/issues/1932), [#1933](https://github.com/zzstoatzz/plyr.fm/issues/1933)): the optimize task took 4m40s and 4m52s for two AIFF uploads on August 24, ~90s of which is streaming the source out of R2 before ffmpeg starts, and the "new track" DM goes out at +3s — so a listener following the notification lands on the greyed state #1934 added rather than a player. defer the DM for `is_optimizing` tracks until the swap lands, and profile the R2→disk stream.
- **the revised private-media permission set is a re-consent event** (#1898): the `authority: "*"` reader permission only takes effect for sessions that consented after it was published, so a member added before their next sign-in cannot mint a credential yet. Credentials also live two hours by protocol with no revocation, so removal from a member list is eventual.
- **Logfire retention is shorter than time-to-report** ([#1813](https://github.com/zzstoatzz/plyr.fm/issues/1813)): on August 9 the project's earliest record was the same morning. A July 6 PDS-blob failure was therefore undiagnosable a month later — the DB row recorded *that* it failed, never why. Both the new mirroring alert and #1811's failure reasons are only worth as much as the window they survive in. Cheap mitigation for anything we may be asked about later: persist the reason next to the row, which outlives any retention setting.
- **the PDS picker offers tracks this deployment can't read** ([#1814](https://github.com/zzstoatzz/plyr.fm/issues/1814)): `pds_savable_count` checks ungated + no blob + not optimizing, none of which establishes that the bytes are reachable from here. After #1811 the failure is at least legible instead of a bare count, but the honest behavior is not to offer them. Both candidate fixes have an objection — a per-track HEAD is request-time I/O for a metadata endpoint, and an `r2_url`-origin heuristic reintroduces origin-sniffing right after #1805 removed it from the write path — so it wants a deliberate call. A third framing: if the record carries an `audioBlob`, mirror it in (#1778) rather than hide the track.
- **`just backend test` runs serially, CI runs `-n auto`** ([#1815](https://github.com/zzstoatzz/plyr.fm/issues/1815)): the two take different paths through `conftest.py` — serial uses `_setup_database_direct` with no template database, no advisory lock, and no per-worker redis db. The entire parallel bootstrap only ever executed in CI, which is why #1809's bugs were invisible locally despite failing 5/5 once run CI's way. Distinct from the shared-compose-project issue below, which is about *concurrent* sessions rather than parallel workers.
- **pre-#1811 deletes orphaned R2 objects** ([#1367](https://github.com/zzstoatzz/plyr.fm/issues/1367)): track delete and account deletion keyed off `file_id`, so for firehose-ingested rows the delete was a silent no-op and the real object stayed in the bucket with nothing referencing it. Fixed going forward; anything already orphaned is still there. Production has only 5 ingested rows today so the historical blast radius is small, and the sweep that would confirm it is the audit #1367 already asks for.
- **a blind jetstream host permanently discards our events** ([#1796](https://github.com/zzstoatzz/plyr.fm/issues/1796)): rotation's fixed 10s cursor rewind cannot cover a blind window in which bsky traffic kept advancing the cursor (verified in production August 8 — see recent work). Silent loss for third-party-client writes, which the write-echo alert cannot see. Narrowed by #2006 (September 3): a rotation triggered by plyr's own unechoed write rewinds the cursor to before that write, so plyr's own records are replayed; foreign-client writes have no stamp, so a blind host still loses them and nothing rotates for them.
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
- iOS PWA audio may hang on first play after backgrounding
- audio may persist after closing bluesky in-app browser on iOS ([#779](https://github.com/zzstoatzz/plyr.fm/issues/779)) - user reported audio and lock screen controls continue after dismissing SFSafariViewController. expo-web-browser has a [known fix](https://github.com/expo/expo/issues/22406) that calls `dismissBrowser()` on close, and bluesky uses a version with the fix, but it didn't help in this case. we [opened an upstream issue](https://github.com/expo/expo/issues/42454) then closed it as duplicate after finding prior art. root cause unclear - may be iOS version specific or edge case timing issue.

### backlog
- drawn iconography: let people draw plyr's own icons doodl-style — slottable icon components, published icon collections, an explore page for them (nate, September 1: "soon, not exactly now"; the sibling repo `doodl` is the reference: `tech.waow.doodl.iconset` maps UI slots to drawing strongRefs)
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- radio: a listener-side skip, and stations composed on the fly instead of prebaked lineups (#2077, from a `!skip` in stream chat, September 19)
- landing: headline totals from `/stats` and a "playing right now" strip of covers with relative timestamps, bandcamp-style (#2078)
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
- framework: SvelteKit with Svelte 5 runes
- runtime: Bun
- hosting: Cloudflare Pages
- interface: persistent player and queue, search and discovery, publishing tools, shared listening, and embeds
- styling: vanilla CSS with shared design tokens
- state management: Svelte 5 runes

**deployment**
- ci/cd: GitHub Actions
- staging: backend (Fly.io) and frontend (Cloudflare Pages) deploy from `main`
- production: separate promote via `just release` (backend/mixed) or `just release-frontend-only` (frontend only); see `docs/internal/deployment/environments.md`
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
- ✅ independent listening and download permissions, inherited as snapshots from Portal/album defaults with per-track overrides; downloads prefer lossless originals, and whole albums use cached zips
- ✅ repeat-one on the desktop player
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

see the [contributing guide](https://docs.plyr.fm/contributing/) for setup instructions, or use the shared [contribute skill](.agents/skills/contribute/SKILL.md) for AI coding assistants.

## documentation

- **public docs**: [docs.plyr.fm](https://docs.plyr.fm) — for listeners, artists, developers, and contributors
- **internal docs**: [docs/internal/](docs/internal/) — deployment, auth internals, runbooks, moderation
- **lexicons**: [docs.plyr.fm/lexicons/overview](https://docs.plyr.fm/lexicons/overview/) — ATProto record schemas

---

this is a living document. last updated 2026-09-20: podcast correction (track 1334), #2081,
#2077/#2078; the September 14–19 write-ups (#2060–#2076) are in `.status_history/2026-09.md`.
