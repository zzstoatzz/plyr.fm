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

### October 2026

#### five backend releases in two days, after none since October 2 (October 16–18)

`2026.1016.192720` (October 16 19:27Z) carried everything merged since
October 2 — the equalizer's backend half (#2134), the embed artwork fallback
(#2138) — plus the day's moderation work; four more followed through October
18 01:11Z, each with a frontend promote. The 19:19Z promote on October 18
cherry-picked #2187 onto `production-fe` (`35c1a0b9`), leaving #2186 and
#2188 on staging; the report calls #2187 staging only, and it is in prod.

#### who you are and where you're headed before the redirect; a station skips a dead entry (#2186–#2188, October 18 — #2187 prod via the 19:19Z promote; #2186, #2188 staging)

- **the sign-in page resolves the handle first** (#2186, nate's request —
  staging): once a typed handle resolves, an avatar row appears with "not
  you?", the button becomes "continue at bsky.social ↗" (or the account's own
  host) and a line says plyr never sees your password. A new
  `GET /auth/sign-in-preview` resolves the handle with the OAuth client's own
  resolver, then fetches the profile and discovers the authorization server;
  the host shown is the authserver's, not the PDS's — the move ewan's October
  7 devlog describes for four other clients. #2188 followed the first staging
  test: a cold lookup took 3–10 s with the button disabled, and the typeahead
  sat over the new row. Only a confirmed 404 blocks sign-in now. Eleven real
  handles resolved to the right hosts on staging. Production's backend answers
  404 on the endpoint and its login bundle does not call it; nothing is broken.
- **radio moves past an entry whose audio is gone** (#2187, from stream chat:
  Juice WRLD tracks on *deep cuts* "seem borked"): one of bismark's 22, "Safe
  Place" (1136), has no R2 object, so `audio.plyr.fm` returns a 404 page. A
  sweep of all 1,221 rows found six public tracks like it (1136 and flo.by's
  930–934) — the unrecoverable rows from the July 30 retrospective; two more
  were on *deep cuts* too. The player's `onerror` returned early in radio
  mode, so one dead entry left a station silent until someone pressed play.
  Radio now marks the url unplayable for the session, airs the next entry
  from zero, and filters every poll snapshot so the slot cannot re-air it.
  The six still 404 outside radio; the artists have not been told.

#### the upload page asks heavy uploaders to sponsor (#2184, October 18 — prod `2026.1018.011142`; announced 03:03Z)

Above `UPLOAD_SPONSOR_THRESHOLD_HOURS` of uploaded audio (default 24; a Fly
secret, no frontend build) the upload page shows a dismissible GitHub
Sponsors card: hours uploaded, and an explicitly estimated scanning cost —
retained successful scans × $1.50/hour, before plan allowances. Private and
unlisted audio count; dismissal lives in account preferences for 30 days;
uploading is unrestricted and nothing is scanned or sent. The announcement
said moderation on uploads is plyr's largest operational cost and that more
sustainability plans are in the works — the wall Möwe's September essay
describes TOKIMEKI's developer hitting a month earlier. The provider-attempt
ledger (#2163) is still the missing accounting.

#### a rejected PDS token is refreshed before the audio stream opens (#2183, October 18 — prod `2026.1018.002803`)

Expired PDS credentials could be rejected before a streamed audio body was
read, surfacing as `ReadError('')` and exhausting retries without a refresh —
the empty-string signature the nonce fix (#2072) had cleared for another
cause. The bodyless nonce probe now propagates `invalid_token` /
`ExpiredToken` 401s into the bounded refresh loop before the stream opens.
Historical tracks are not repaired; an invalid refresh grant still needs
re-authentication. The mirroring alert's window went from an hour (each
event fired four times) to 15 minutes.

#### uploads failed for two weeks in three ways, and the worker stalled with a live heartbeat (#2170, #2171, #2180, #2181, issue #2168, October 12–17 — prod `2026.1017.062711`)

A census of October 3–17 upload jobs
(`docs/internal/retrospectives/2026-10-17-upload-failures.md`): 157 jobs,
110 completed, 33 duplicate-rejected from one account, 14 real failures
across four accounts.

- **a 1.08 GiB FLAC failed seven times** (October 12–13): the API advertised
  1.5 GiB, the deployed transcoder capped the request body at 1 GiB, and the
  rejection came back as an empty `ReadError` stored as "unexpected error: ".
  Each attempt cost the uploader 11–16 minutes. One packaged size contract
  now drives API admission and the transcoder — 1.5 GiB of file plus a
  separate multipart allowance; one byte over is a 413 — and the release
  workflow deploys the matching transcoder before the backend. Staging and
  production each carried a real 1.5 GiB upload through conversion, playback
  and cleanup: about 14 and 16 minutes, which is now the follow-up.
- **the worker stopped consuming while its heartbeat stayed one second old**
  (October 16 22:04Z → 17 04:38Z): after a Redis restart the Docket consumer
  died and the heartbeat task did not. Over 400 tasks backed up — including
  the reaper that would have failed the stuck uploads at ten minutes — and
  three uploads waited 91–103 minutes until nate restarted the one machine,
  then were marked failed rather than recovered. Consumer failure now
  terminates the worker process so Fly restarts it, and `/health/freshness`
  checks overdue and unread queue work without consulting the heartbeat. The
  failure is reproduced under a real Redis interruption, not recovered from a
  stack. #2168 asks for the approval-gated recovery loop.
- also on the way: Fly resolves `[build].dockerfile` relative to the config
  directory, so the first staging rollout stopped before deploying (#2171);
  the Redis deploy workflow had the same doubled path as #2115 (#2173, fixed
  and deployed on merge).

#### a silent Redis froze the whole API (#2161, October 16 — prod `2026.1016.204035`)

A Redis connection that accepts requests and never replies stalled staging
entirely, health checks included; py-spy caught the process inside SlowAPI's
synchronous `evalsha` on the event loop. Redis reads are bounded at 500 ms
with no retries, limit checks run in the thread pool, and the per-process
fallback keeps enforcing limits during an outage. Verified against a real
silent TCP server. Promotion waited on Fly control-plane failures during
rolling host reboots that afternoon (#2156).

#### moderation: a private decision not to index, and a snapshot that could erase labels (#2149–#2151, #2156, October 16 — prod `2026.1016.192720`; the service deploys straight to the shared production instance)

- **a missing credential looked like an empty authority** (#2149): the label
  and override snapshots came back empty for absent credentials or a
  malformed response, and the five-minute reconciliation read empty as "clear
  everything". Both are validated before any row changes; a valid empty
  snapshot still clears withdrawn decisions. Staging's first deploy failed
  because its database was stamped by the unmerged native sign-in experiment
  (#2142); with nate's say-so it was downgraded and the experiment set aside.
- **"do not index" exists now, privately** (#2150, #2151): exact-URI
  `indexing_exclude` / `indexing_clear` events in the moderation service —
  latest wins, no label, no transparency post, no review closed — and ingest
  asks before creating, finalizing or updating a track, treating an
  unavailable authority as a retry rather than permission. Deletes never ask;
  the unknown-artist gate stays. 42 exclusions were written (events 218–259)
  for records nate omitted on purpose — 33 under `prefect.io`, 9 under his
  devlog account — and verified absent after the release. The audit
  (`docs/internal/research/2026-10-16-moderation-admission.md`) found 51
  current records absent from the index across nine artists; the other nine
  wait on investigation. Its reliability findings are in known issues.

#### drawers and trays learned to be touched (#2148, #2167, #2179, #2182, October 17 — frontend promotes 06:09Z, 06:30Z, 19:42Z)

Tray handles ignored mouse drags, fought native scrolling, and stopped
dismissing after the content scrolled. Comments, likers and audio revisions
got a 44 px handle that drags, taps and takes the keyboard (#2148); then the
whole drawer answers a downward pull from the header or a list at its scroll
top (#2167 — the first downward `touchmove` is cancelled, because pointer
events cannot reclaim a vertical pan once it has gone native); a hard swipe
no longer jumps back for the closing transition (#2179); and the comments
close button sits in its own header row instead of 11 px into the composer
(#2182). Verified with emulated touch in Chromium and Zen; no physical phone
or in-app webview yet. On the native app branch, sheets land with a soft
haptic (#2169, TestFlight build 23; not on `main`).

#### smaller, October 16–17

- the track embed tries the full-size album cover before stretching a 96 px
  thumbnail (#2159, track 1227 again); an artist link in the queue navigates
  without stopping the audio (#2160) — promote 20:09Z.
- the production browser smoke switches the equalizer on mid-track and reads
  a signed-in-only track through the CORS proxy (#2157): it passed, and found
  cached public audio missing CORS headers — a purge was not enough, so a
  Cloudflare response-header rule on `audio.plyr.fm` adds one wildcard header
  on cache hits. The equalizer's prod split is closed.
- staging audio replacements no longer call AuDD (#2166, closes #2164).
- Storybook runs every story in light and dark; the real light theme failed
  the contrast gate on links, tags, badges and EQ controls, fixed with a
  theme-aware foreground token (#2177). CI rejects stale lockfiles (#2172),
  image-only backend changes count as release inputs (#2174), each backend
  test gets its own client lifespan (#2176), and the contributor docs match
  the recipes — Python 3.12, the API callback on 8001, Redis plus a worker
  for queued tasks (#2175, #2178).
- filed: keep-playing repeats the same For You continuation (#2158); queue
  restoration may overwrite a track picked during load (#2162); initial track
  artwork is never image-scanned (#2165); of-matches asked for Opus instead
  of MP3 renditions (#2185). eurocity.band's track 1449 went up October 16.

#### the status podcast was rewritten for listeners, and a year-one episode went out (#2145, #2146, October 11 — track 1394)

The episode's rules moved to `.github/prompts/status-podcast.md`: written for
someone who likes music and may use plyr, two or three stories about named
people, the protocol in one clause, no PR numbers spoken; new Gemini voices
and `[note]` delivery cues. A `podcast lab` workflow renders candidates on
any branch without uploading. Merging a PR labeled `status-episode` uploads
its episode: #2146 published "plyr.fm update - year one" (track 1394),
unannounced. The October 12 scheduled run opened #2147, still open, so its
October 11–12 episode never rendered; this run covers that window.

#### October 1–9

See `.status_history/2026-10.md` for the full entries. Headlines: a copyright
flag means a recording plays through the upload — four in-step AuDD samples
replace match-share (#2112–#2117, October 1 — prod `2026.1001.062017`,
`2026.1002.021006`); spaces credentials signed per the current
permissioned-data branch, tracks from other clients mirrored (#2121, #2122,
#2124, October 2 — prod `2026.1002.021006`, `.054138`); the review queue's
first decisions, 76 → 33 open (October 2, no code); the embeds, the radio
page's loose ends and the in-browser equalizer (#2111, #2129–#2138, October
3–9 — frontend promotes October 8–9; the backend halves of #2134 and #2138
reached prod in `2026.1016.192720`).

### September 2026

See `.status_history/2026-09.md` for detailed history. Headlines: the radio
page became the sister-radio fork and four stations joined Ana's network
(#2097–#2107, September 28 — prod `2026.0928.035150`, `2026.0928.140223`);
the musician studio paused, then removed (#2083, #2094); `/health/freshness`
and the reaper's null trap (#2084–#2087); Blacksky's `repo:?` fix (#2089);
an upload is two writes and one promise (#2075); the DPoP nonce (#2072,
#2073); publishing permissions independent of storage (#2047–#2058).

### August 2026

See `.status_history/2026-08.md` for detailed history. Headlines: client-side
writes phase 0, shipped and reverted (#1948–#1952); resumable uploads (#1947);
attested.network supporter gating (#1936–#1939); the queue as a surface
(#1907–#1924); editing a track deleted its PDS audio (#1904).

### November 2025 – July 2026

See `.status_history/`, one file per month, `2025-11.md` through `2026-07.md`;
arcs that left current focus are in `2026-09.md`, anything live in known issues.
## priorities

### current focus

**the radio page is the sister-radio fork, and the catalog is on the sister
network** (#2097–#2107, September 28 — prod `2026.0928.035150`,
`2026.0928.140223`; `plyr-radio` Fly app): the vendored SolidJS page from our
fork of Ana's sister-radio drives plyr's one audio element; presence is a
Redis lease per socket, identity from the session cookie only; four stations
are `did:web` identities with signed `pet.nkp.radio.station` records that
Ana's tuner discovers. Firehose is the single live HLS exception, and since
October 9 the radio embed airs it too (#2136); since October 18 a station skips
an entry whose audio is gone (#2187). **next**:
#2102 moves the protocol surface into the backend and retires the one-machine
adapter (its signing key lives on a volume — losing it changes the station's
public key); verify mute, HLS and the reported track-boundary loop on a
physical iPhone; decide whether the compact embed gets a Media Session policy.

**an upload is two writes and one promise** (#2063, #2070, #2075, September
18–19 — prod `2026.0918.172630` → `2026.0919.214851`): the job row now decides
whether an upload is alive, hints precede bytes, and a failed job's media is
re-swept for seven days. The same window closed three races of one shape —
the Jetstream echo of plyr's own PDS write beating the task that made it
(#2066, #2069, #2070) — and the double-submitted form (#2063). Since
September 21 an external monitor can read the pipeline's pulse at
`/health/freshness`, and the reaper sweeps the pre-worker `pending` rows that
check measures (#2084, #2085, #2087). On October 17 (#2170, prod
`2026.1017.062711`) admission and the transcoder share one size contract, a
dead consumer takes the worker process down with it, and freshness reads queue
age without the heartbeat. **next**: #2168's approval-gated restart; the
16-minute 1.5 GiB upload; the exception class persisted in failed jobs; and,
from garrison's essay: verify
the promoted object inside the publication step; a read-only inventory of
`audio/` against every media column; a sweep on `result.transfer`; a
compare-and-set finalize in `ingest_track_create` so the post-create hooks
cannot run twice (known issues); and, once a PDS nonce problem is not the
first suspect, a test account on blacksky.app.

**publishing permissions are independent of storage** (#2049, #2056, #2057):
Portal defaults, album application and per-track exceptions are in production.
Listening audience, downloads, discovery and rights metadata are separate choices.
Today “my Space members” also means private metadata; private R2 audio alone does
not hide a work. Future Space-backed storage must preserve those audience choices,
rather than turn every protected work into members-only content. Moving existing
works across Space boundaries remains a separate migration decision.

**records are moving into the client's hands — parked until the sign-in design is redone** (plan `docs/plans/2026-08-31-client-side-writes.md`; #1948–#1950 shipped in prod `2026.0901.065150`, reverted September 1 in #1952): phase 0 made the frontend a second OAuth client and chained its consent after the cookie login, so every sign-in showed two authorization screens. the direction stands — the file an artist uploads goes in their PDS as-is, plyr indexes/mirrors/serves, and the backend stops authoring records on anyone's behalf — but the next attempt must fit inside the single existing login, with scope growing only when a feature that needs it is used. **next**: redesign how the browser gets a repo-write capability without a second flow, then phase 1 (likes).

the August arcs that sat here until September 20 — the spotify footer, supporter standing via attested.network, the iOS lock-screen scrubber, the credential chain — are in `.status_history/2026-09.md` under "priorities archived 2026-09-20"; their open threads are in known issues.

**still experimental — private media on permissioned spaces** (#1557→#1574, #1684, #1876–#1905, epic #1384): private audio in an artist-owned permissioned space (never R2), credential-gated playback, and since August 22 an artist-named member list rather than owner-only — the `simplespace` member list on the artist's PDS decides, and plyr never stores membership: it asks the space host for a credential with the reader's session and holds that answer for the credential's lifetime (a refusal for five minutes), so a change the artist makes from any client is honored without plyr in the loop (August 23). Every sign-in now requests the private-media permission set and a spaces PDS expands it into `space:` grants at consent, so the *grant* is the capability signal (advertised `scopes_supported` never listed the dynamic scopes and hid the feature from the official alpha PDS). **open**: the cross-account e2e leg needs its `ALPHA_TEST_*` secrets; membership and supporter standing stay separate facts by design; downloads of private tracks are still refused for everyone, owner included, until a private download byte path exists. Design: `docs/internal/architecture/private-media-access-list.md`. the wire contract is the spaces-alpha lexicons at the tip of atproto's `permissioned-data` branch, with Bulletin as the reference client; zds tracks that branch and has rejected stale bodies twice (#1656, #1876), so drift there shows up as a failed first private upload. The July Proposal-0016 alignment replaces the obsolete `ats://` draft addresses with canonical `at://{authority}/space/{type}/{skey}` addresses, separates the space-type lexicon from the OAuth permission set, resolves dedicated space hosts with PDS fallback, and sends a confidential-client attestation separately from the user's delegation token. The current owner-only policy remains intentionally narrow; interoperable catalog sharing needs a product policy and UX on top of the protocol primitives. See `docs/internal/architecture/permissioned-private-media.md`.

**next**: remove the `/admin/*` machine-endpoint aliases now that prod calls `/internal/*` (#1691); re-enable `test_private_media.py` somewhere that has the local postgres/redis fixtures (it is excluded from the staging-facing workflow). which surfaces beyond albums/playlists count as queueable contexts (artist catalogs #1353, feeds/search). publish the five record lexicons (`fm.plyr.track`, `.like`, `.comment`, `.list`, `.actor.profile`) with a docs-quality pass on each (next phase after #1569); a production smoke-test harness for private media (file-types × visibilities, fully inert — no DM/listing/stats — per prod release); enable the `copyright-paradigm` flag for own DID and start dogfooding on prod; co-writer / publisher editing UI for `additionalInterestedParties` (backend plumbed end-to-end, frontend deferred); prefill ISWC/ISRC/masterOwner on the portal edit form (we only have the URIs locally, not field contents); fly worker tcp health check (running-but-stuck symptom detector); upstream `atproto_oauth.OAuthClient` body-factory support (lets us drop `_signed_streaming_post`); deploy-docs sanity check; `config.py` decomposition.

### known issues

- **`production-fe` is no longer a fast-forward of `main`** (October 18 19:19Z): #2187 was cherry-picked onto the branch as `35c1a0b9` rather than promoting `main`, which would have carried #2186 and #2188. `just release-frontend-only` pushes `origin/main:production-fe`; the remote will reject that as non-fast-forward until the branch is reset onto `main` (or the push forced), and the next promote carries the sign-in preview whether or not it is wanted yet.
- **worker recovery is still a person restarting a machine** (#2168, October 17): a consumer that dies now exits the process, but anything that leaves the heartbeat fresh and the queue growing still needs someone to read `/health/freshness` and act. The three uploads failed on October 17 and the seven October 12–13 attempts were not restored or retried, and the uploaders have not been contacted. A 1.5 GiB upload takes about 16 minutes on prod, most of it before transcoding starts (#2181).
- **the moderation audit's reliability findings are unfixed** (`docs/internal/research/2026-10-16-moderation-admission.md`, October 16): the label subscription sends JSON text where the event-stream spec requires CBOR frames; replay covers 1,000 rows and treats process-local broadcast order as sequence order, so a committed label can be missed; all three active labels carry CIDs that differ from the indexed track CIDs (value equality hides version drift); `get_negated_labels` returns historical negations, so the resolution sync could clear a flag raised again later. Code risks, none reproduced live. Nine records absent from the index for no known reason await investigation.
- **the drawer gestures have not touched a phone** (#2148, #2167, #2179, October 17): verified with emulated touch in Chromium and Zen; the Bluesky and Instagram webviews they were built for, and any physical device, are untested.
- **two queue bugs are filed and unreproduced** (October 16): restoration may overwrite a track selected during page load (#2162, seen in the production EQ smoke), and keep-playing repeatedly starts the same For You continuation (#2158, reported) even though `fillContinuation` already shuffles.
- **native radio has not been checked on a physical iPhone** (#2101, #2104, #2105, September 28): the mute fix targets a Safari behavior (`volume = 0` ignored) verified only with a stubbed element; a reported iPhone loop at a track boundary was not reproduced on desktop; HLS Firehose and the lock-screen presentation are unverified on a device. The same gap as the live-radio item below, now for the whole page. Station switching that "plays for a while and then dies" got a fix on October 8 (#2111) written as a hope; whether it held is unreported.
- **sister-radio syndication is one Fly machine with no redundancy** (#2103 → #2102): the `plyr-radio` adapter advertises four stations from a 512 MB machine in Chicago; if it is down, native `/radio` keeps playing but Ana's directory drops the stations after health checks. Consolidation into the backend is the fix.
- **post-create hooks may run twice when the Jetstream echo and the upload task both finalize a track** (staging track 9392, September 18, unreproduced): `ingest_track_create` finalizes a pending row with a plain ORM write, not a compare-and-set, and the upload task's own `post-create hooks completed` landed 14 s after `ingest: finalized pending track` for the same row. The hooks send the notification DM and start the copyright scan. Written up in #2070.
- **a track that publishes while its worker stalls keeps a `failed` job** (#2075, intentional for now): the user is told "timed out — please re-upload" and the re-upload is rejected as a duplicate. Teaching the reaper to recognize the committed track row and complete the job is deferred.
- **PDS blob upload to blacksky.app is unverified after the nonce fix** (#2072): the September 9 failure there had the same `ReadError('')` signature as selfhosted.social, which the fix cleared in prod, but there is no test account on blacksky. #2089 (September 22) fixed a separate Blacksky problem — sign-in dying on its `repo:?` scope serialization — and does not settle this one.
- **the Blacksky sign-in shim is still needed; nothing was filed upstream** (#2089, re-checked October 10): `oauth_compat.py` rewrites `repo:?collection=…` to `repo?collection=…` in the granted scope, for the exact issuer `https://blacksky.app` and nowhere else, before the normal scope check. Blacksky's PDS (rsky) still writes the stray colon at commit `7964ffa` (October 9): its repo prefix constant is `repo:`, `to_repo_scope` appends `?` to it, and its own test asserts the result starts with `repo:?`. Bluesky's reference parser (`@atproto/oauth-scopes`, October 9) rejects a positional part alongside a named `collection`, and the Python client follows it, so without the shim every Blacksky sign-in ends in `Scope mismatch`. It loosens no permission. Remove it when rsky emits `repo?`; the decision on October 10 was not to open an upstream issue.
- **the upload-stall alert shows three job IDs plus "(+N more)"** (#2087): the triage runbook's step 5 says to use the full IDs from the alert; the rest are in Logfire. The freshness monitor's wiring lives outside this repo.
- **nothing alerts when a workflow on main is red**: `e2e private media` failed on ten consecutive pushes (September 12–18) before anyone looked. `gh run list --workflow "e2e private media"` is the check until there is one.
- **the cross-account member leg of the private-media e2e still skips**: `ALPHA_TEST_HANDLE`/`ALPHA_TEST_PASSWORD` are not set, so the flow that adds a second account to a Space and plays the track never runs in CI.
- **light777.selfhosted.social's duplicate track (1323/1324) is theirs to remove**: same `file_id`, one R2 object; the refcount guard keeps the audio when either row is deleted. `test_refcount_prevents_r2_deletion` covers it.
- **staging has two artist rows for `nate.selfhosted.social`**: `GET /artists/by-handle/…` and `GET /albums/…` 500 with `MultipleResultsFound` on staging; prod has one row.
- **browser private-media e2e stops at PDS sign-in** (September 13): runs [34767184692](https://github.com/zzstoatzz/plyr.fm/actions/runs/34767184692) and [34785740209](https://github.com/zzstoatzz/plyr.fm/actions/runs/34785740209) both timed out before upload or playback because the browser blocked the `pds.zat.dev` authorization form under `form-action 'self'`. This predates #2057. Authenticated API and actual Space blob smoke passed; they do not prove that browser sign-in/upload works. The CSP cause remains unresolved.
- **initial track artwork is never image-scanned, and a failed scan leaves no trace** (#2165, October 16; the September 13 400 on track 1303 is the same hole): `stage_image_to_storage` passes `scan_moderation=False` and nothing scans later, while cover *edits* do scan. 60 retained tracks with artwork over 30 days against eight successful image scans in the moderation database. The one scheduled scan that returned 400 was swallowed without a durable unresolved row.
- **66 production tracks lost their PDS blob to the edit bug** (#1904 fixed the bug, August 22): every metadata edit rebuilt the PDS record without `audioBlob`, so the PDS garbage-collected the blob and jetstream mirrored the blob-less record back. 21 artists affected since March 18; the audio still exists in R2. Repairing means re-uploading and rewriting records on other people's behalf, so it is **deliberately not done** — it waits on nate's call about consent (heads-up post or opt-in). affected rows: `audio_storage='r2' AND pds_blob_size IS NOT NULL AND pds_blob_cid IS NULL`.
- **seven tracks are still dead, and `audit_media_integrity.py` is not scheduled** (#1735/#1737): of the 20 broken by staged-cleanup deletion, 13 were recovered; the remaining 7 have no object in any of our buckets and no PDS blob, because they predate PDS mirroring. Not recoverable by us — the artists almost certainly still hold their source files, so the remedy is asking them to re-upload. The audit script exists and exits 1 on a missing object, but nothing runs it on a schedule yet. #2187 (October 18) met three of them in *deep cuts* rotation — 1136, 930 and 934 — and radio now skips them; six public tracks 404 in total (1136, 930–934), still listed, artists still not told.
- **33 subjects await a call in the review queue** (recounted October 2, after the first decisions): 11 leaked or unreleased recordings of another artist from one account, where de-listing is undecided; about 16 that need someone to listen, mostly claimed covers; 3 unofficial remixes, waiting on a policy; and track 64, which reads as a mix but carries user report #5 from @vicwalker.dev.br. Still unset: how unofficial remixes are treated, and whether a whole-track match from an unrelated account is enough to label without listening.
- **uploaders of 17 wrongly flagged tracks were never told** (October 1): the old rule showed them a copyright badge on their own track in the portal, some for two months. The flags are cleared; no notice was sent, by decision that day. One uploader replaced the audio four times while flagged.
- **two tracks cannot be scanned**: AuDD cannot extract audio from track 123's 19 KB file, and track 930 has sat in `pending` since April with an `r2_url` that returns 404. Three private tracks are unscanned by design.
- **the status podcast renders again, on a new Gemini key** ([#2123](https://github.com/zzstoatzz/plyr.fm/issues/2123), October 10): from about October 1 Google answered every generation call on the old key's project with `403 project has been denied access`, though the key still listed models; why that project was denied was never learned. A key on a different project was set as `GOOGLE_API_KEY` on October 10 and the September 23 → October 10 episode rendered with `gemini-3.8-flash-tts`; the October 11 lab runs and the year-one render succeeded on it. The episodes for September 23 → October 2 and October 2 → 5 were never made; this one covers both windows. **If Gemini refuses, the run fails and there is no episode**: a fallback voice (Kokoro on the runner) was built and rejected the same day as below the bar for something published under the project's name (#2140, closed unmerged). `google-genai` is still unpinned in `scripts/generate_tts.py`.
- **a review item cannot be annotated without closing it**: an internal mark is an `acknowledged` event with a reason, so undecided items carry no note. A fan-taping mark published through the labeler has been raised as an idea and is not built.
- **copyright spend is not on the live cost feed**: AuDD is computed from hardcoded plan constants and Claude image moderation is tracked nowhere. The five-minute labeler poll (`sync_copyright_resolutions`) also likely keeps the moderation database from scaling to zero; the Neon side is unconfirmed.
- **no per-actor authentication**: the moderation service trusts one shared `MODERATION_AUTH_TOKEN`, so the event log's `actor` is a claim rather than a verified identity. This is the gate on letting an agent *act* rather than propose, and on review genuinely not always being one person.
- **the DMCA surface is incomplete** ([#1715](https://github.com/zzstoatzz/plyr.fm/issues/1715)): the agent is registered and reachable at `dmca@plyr.fm`, but the site does not publish the notice requirements or a counter-notice procedure, and there is no repeat-infringer counter — takedowns are recorded per track in `moderation_events`, never aggregated per uploader. The published-agent half is additionally blocked on a non-residential address.
- `/costs` shows Cloudflare at $0 — upstream gap: CF line items aren't yet tagged `project=="plyr.fm"` in my-prefect-server, so the live feed can't attribute them (#1599).
- **the iOS lock-screen scrubber cannot be dragged in the real app** ([#1870](https://github.com/zzstoatzz/plyr.fm/issues/1870)): metadata, times, and ⏮/⏭ all work; the scrubber never grabs on a physical iPhone under any of five media-session recipes, while SoundCloud's web player scrubs in the same Safari. the deciding experiment — a minimal page on a physical phone, or Web Inspector attached to the device — has not run yet; the code is deliberately parked at the #1860 state.
- **26 older items, open and unchanged since August–September, moved to `.status_history/2026-10.md` under "known issues archived 2026-10-19"**: the JAX colo 5xx on the media domains; the broker proof that pins nothing (#1939); the un-retried notification DM; the five-minute wait for non-web-playable uploads (#1932, #1933); the re-consent permission set (#1898); Logfire retention (#1813); the PDS picker (#1814); serial vs parallel tests (#1815); orphaned R2 objects (#1367); the blind jetstream host (#1796); the shared test database; `did:web` scans from a mutable source (#1778); the transcoder's fail-open auth (#1780); CORS with credentials (#208); staging's `SELECT neondb` spans; no listening history; the firehose station's missing fallback (#1741); the radio retry loop and WebKit-only live verification (#1750); the rev guard and unordered comment/list updates (#1736); `_reference_count` and `r2_url` (#1735); the account-status script (#1729); the iOS skip handlers (#1958), PWA first-play hang and in-app browser audio (#779).

### backlog
- drawn iconography: let people draw plyr's own icons doodl-style — slottable icon components, published icon collections, an explore page for them (nate, September 1: "soon, not exactly now"; the sibling repo `doodl` is the reference: `tech.waow.doodl.iconset` maps UI slots to drawing strongRefs)
- Jetstream audit trail / activity feed integration — persistent log of firehose events, toggle for visibility
- radio: a listener-side skip, and stations composed on the fly instead of prebaked lineups (#2077, from a `!skip` in stream chat, September 19)
- landing: headline totals from `/stats` and a "playing right now" strip of covers with relative timestamps, bandcamp-style (#2078)
- share to bluesky (#334)
- lyrics and annotations (#373)
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

this is a living document. last updated 2026-10-19 (status maintenance): the
October 11–18 window written up (#2145–#2188) — five releases, the upload
retrospective, the sponsor card, moderation admission, the sign-in preview on
staging; the equalizer and Redis-deploy known issues closed; #2187's landing
corrected against the report; the October 1–9 entries and 26 dormant known
issues moved to `.status_history/2026-10.md`. before that, 2026-10-10: the
October 3–9 window (#2111–#2138). #2147 (October 12) is still open.
