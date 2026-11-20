# next paused handoff

November 12, 2026, approximately 16:40 UTC. Nate explicitly paused the goal and
asked for a good stopping point. Do not resume implementation, merge, deploy or
dispatch acceptance work until asked. Production was not promoted.

## resume from here

The [daily-driver plan](../plans/2026-11-12-next-daily-driver.md) remains the scope.
The bounded parity pass is complete; do not restart it. Earlier shipped backend,
portal, profile links, account AI labels, player, library, collections and private
media work is in the [checkpoint](2026-11-12-next-daily-driver-checkpoint.md).
This handoff supersedes its older processing/download status.

The next decisive evidence is a real small processed upload, then the full-size
processed upload. The fixture is implemented and deployed, but **neither has run**.
Several client PRs are ready but deliberately unmerged. One supporter client
worktree contains unfinished, uncommitted work; preserve it.

## deployed state at pause

Main is `4c187499c68bbff3ca1019d04763a15a51946899`.

| Change | Merged revision | Observed deployment |
| --- | --- | --- |
| #2537 public downloads | `d1ca5c5e` | Next web `43246370787` succeeded |
| #2533 durable processing ownership | `d64d734f` | Next `43247143541`, audio `43247143610`, staging `43247143557` succeeded |
| #2538 typed processing failures | `6deaa822` | Audio `43252744754`, staging `43252745070` succeeded |
| #2540 processing client transport/model | `71c7ec3f` | Web `43249433383` succeeded; no processing controls added |
| #2543 cloud processing acceptance fixture | `adac109b` | Audio `43250849296` succeeded; fixture not dispatched |
| #2541 processing generation/manifest/metrics | `49fa82e1` | Included in final combined deployment below |
| #2542 staging executor wiring | `af41ae8c` | Audio `43258549260`, staging `43258549597` succeeded |
| #2546 coordinator admission gate | `4c187499` | Next `43259663424`, attempt 2, succeeded |

**Processing admission is enabled live**, not merely merged. Both
`plyr-jams-next` machines were observed running the `4c187499` image with
`UPLOAD_PROCESSING_ENABLED=true`. Attempt 1 failed connecting to the Fly Depot
builder (handshake EOF); the already-dispatched retry completed before pause
observation. Do not repeat it.

Combined runtime verification observed:

- Worker version `fdf9184e-455e-4089-9dee-3c4fc1bcb847` at
  `https://plyr-next-audio.n8-3e9.workers.dev`.
- Exactly one started staging executor in `iad`, using the final deployment's
  image, `auto_stop_machines=false`, `min_machines_running=1`, and the expected
  processing origin. No second warm executor.
- Health 200; an unauthorized processing request returned 401. A correctly
  authenticated but deliberately invalid attempt returned 400 without creating
  a job, establishing credential pairing.
- No cloud processing job or new processing reservation was created.

The dedicated processing credential is provisioned in canonical SOPS
`plyr_next.processing_auth_token`, GitHub `PLYR_NEXT_PROCESSING_AUTH_TOKEN`,
staging Fly `NEXT_PROCESSING_AUTH_TOKEN`, and Worker
`PROCESSING_TRANSCODER_KEY`. No existing credential was rotated. Local encrypted
store history includes `fd222bd` and `6303d32`; never print values.

The warm staging executor is intentionally still running. Its prior estimated
shared-CPU/1-GiB `iad` cost is about $6.70/month, before other costs; cheaper
overall operation has not been proven. This is not a production cutover.

## live workflow and merge discipline

Integration **`43259136236`** was still running at final handoff observation
(suite succeeded, capacity active). Leave it alone and inspect its exact handle
on resume. Prior runs `43247585011` and `43253311338` completed successfully,
each with 22 suite tests and one large-FLAC capacity test. They verify legacy
staging, not the Next processing pipeline.

The superseded intermediate staging deployment `43258535091` was deliberately
cancelled before it could launch integration during the final rollout. No live
integration was cancelled. Final deployment `43258549597` succeeded.

Do not run small/full processing acceptance while legacy integration uses the
shared staging transcoder. Do not merge runtime changes during the processing
fixture. Check any private-E2E waiter before advancing main: it can depend on the
latest main Pages deployment. An isolated Next-only configuration change does
not itself restart legacy staging; assess actual workflow paths rather than
assuming all backend changes share the same deployment.

## open PRs and local work

All worktrees below are under `/Users/nate/.codex/worktrees/`, ending in
`/plyr.fm`. No production releases are authorized.

| PR / worktree | Exact reviewed head | State and remaining gate |
| --- | --- | --- |
| #2539 `next-download-preferences` | `f44d921da2631d60115dbf77184412339634b43f` | Draft, green; public download-policy editing with CAS/recovery. Actual native Save pending. |
| #2544 `next-original-downloads` | `45c8ef13414f1ab986a4a7cabc430135d0c49089` | Draft, green; processed playback/original choice. #2541 is now deployed; native choice/save pending. |
| #2545 `next-processing-client` | `27d3e300fde39c32c4bd70fbcfd6bd89bf5fc563` | Draft, green; 135 tests, five processing plus four raw browser cases. Real cloud processing and native acceptance pending. |
| #2547 `next-upload-checkpoint` | `d5c701a8703ab83e4375911f03350b719b785ceb` | Draft, green; older evidence snapshot. Update its now-stale disabled-processing wording before merging. |
| #2548 `next-protected-downloads` | `421ea1257c29c957ff6f3612cbaa15ba67311cd4` | Draft, green; stacked on #2544. 137 tests, eight protected browser layouts, exact bytes/MAC checks and explicit cancellation. Native streamed file/share/cancel cleanup pending. |
| #2549 `next-attested-binding` | `20736d1805cd7e312e4aba18c5a3ff56d3ebbfa4` | Reviewed, green; existing supporter proof binding fix. Held through processing acceptance. |
| #2550 `next-supporter-download-authorization` | `2c9dd51915e72d0e77a5543715e76d4cb995ddb3` | Draft, reviewed, green; stacked on #2549. Backend-only authorization endpoint; held through processing acceptance. |
| no PR: `next-supporter-downloads` | Base `421ea1257c29c957ff6f3612cbaa15ba67311cd4` | Uncommitted WIP. Preserve modified and untracked files. See below. |

PR URLs are `https://github.com/zzstoatzz/plyr.fm/pull/<number>`.
Before merging stacked branches, rebase carefully and inspect the range diff;
their PRs target main so CI runs, and currently include dependency diffs.

The supporter client WIP adds a dedicated OAuth RPC grant, strict viewer/URI/CID/
policy/expiry response validation, fresh effective track/playback checks after
authorization, and existing protected-record MAC/policy checks. It reuses the
download delivery/cache owner and TrackMenu's iOS dismissal/navigation seam.
The 30-second decision is checked immediately before bytes start, not throughout
an already-authorized slow transfer; session changes and cancellation still abort.

143 tests, typecheck and eight new rendered layouts passed before a final small
legacy-401 copy change. That latest change was not yet validated at the pause
instruction; do not describe the whole dirty tree as green. Modified files include
auth config/state, TrackMenu, download model/delivery/policy, README and tests.
New files include `downloads/session.ts`, `downloads/supporter.ts`,
`tests/supporter-downloads.test.ts`, and `scripts/check-supporter-downloads.cjs`.
Native owns this worktree; root's early record-shape finding was fixed without a
type assertion before the prior tests. A client change must ship after its backend.

The already-running regression matrix subsequently finished successfully: four
protected open/ask cases, four public/original cases and the full player matrix.
That does not validate the final legacy-401 source/test change. The first
390px/light reconnect screenshot caught a transition and needs a settled recapture.
WIP backups are `/tmp/plyr-supporter-download-wip.patch` and
`/tmp/plyr-supporter-download-wip-new-files.tgz`; the worktree is authoritative,
so do not blindly reapply them.

## acceptance to run after resuming

1. Revalidate the exact live deployment and integration handles above. Wait for
   the shared transcoder to be idle; do not cancel tests to obtain a slot.
2. Dispatch **one** small processing fixture via `deploy-next-audio.yml` on main,
   with `verify_processing=true` and `full_size=false`. The workflow condition
   runs acceptance for that flag; `verify_upload` need not be separately enabled.
   Root owns this dispatch; do not duplicate it across agents.
3. Inspect the `full-size-upload-acceptance` artifact: reservation, observed
   processing generation, receipt and exact cleanup. Confirm original hash,
   MP3 codec/44.1-kHz/320-kbps metadata and full decode, manifest, unpublished 404s,
   attachment HEAD/Range/CORS, signed publication, and released reservation.
4. Only after small acceptance and cleanup succeed, dispatch the same workflow
   with `verify_processing=true`, `full_size=true` for 1.5 GiB. Capture executor
   UUID/generation logs with `scratch_available_bytes` and
   `owned_scratch_peak_file_bytes`; the latter is owned logical file size, not
   total-machine allocated peak. Do not load large files on this laptop.
5. On failure, inspect that exact artifact and generation. Unfinished processing
   deliberately retains source/output bytes and quota. Do not create a fresh
   reservation to evade recovery, delete a prefix, or reset the durable object.
6. Complete native gates once the Mac is unlocked; then land the client chain
   with refreshed source/visual verification. Real OAuth consent remains a
   separate acceptance requirement.
7. After processing acceptance, land #2549 then #2550 with exact deployment
   verification, and finish the supporter client WIP against that deployed
   contract. Refresh the checkpoint as one batch, not after every poll.

Fixture source lives in `next/services/audio/scripts/verify-upload.mjs` and
`processing-fixture.mjs`. Root's clean acceptance worktree is
`next-processing-acceptance/plyr.fm`, branch `test/next-processing-acceptance`,
pre-merge head `089e9a49`; its PR #2543 is merged. The workflow budget is 55 minutes.
Small source is 768,044 bytes with 1 MiB output reservation. Full source is
1,610,612,736 bytes with 128 MiB output reservation. Artifacts expire after 3 days.

## evidence and constraints worth preserving

- Real raw 1.5-GiB acceptance already passed in `43244675993`: same failed fixture
  resumed 69 of 154 parts, maximum read 10 MiB, peak RSS 191,934,464 bytes, exact
  source hash verified and exact record/object cleaned. This proves raw transfer
  and recovery, not conversion. Evidence: `/tmp/next-fullsize-43244675993`.
  A separate old 4,044-byte reservation may remain; do not claim the account has
  no other quota state or reset it indiscriminately.
- Public downloads #2537 passed eight deployed browser cases and rebuilt iOS
  simulator Save to Files with exact 16,044 bytes and temporary-file cleanup.
  This does not establish the new protected streaming/native paths.
- #2545 fixes small AIFF/WebM bypass: required conversion is selected and cannot
  be switched off; the handler guards before reservation/blob writes. Storage
  budgeting is under advanced options; public permanence consent stays visible.
- #2548 supports only explicit open/ask on both fresh public and MAC-verified
  protected records. Unknown/missing/off/supporter policies, private visibility,
  and unsupported gates deny. Read permission alone is not download permission.
- #2549 verifies both broker-proof and payer/payment CID bindings using the
  [badge.blue specification](https://badge.blue/#verification). Independent JS
  golden vectors, old-verifier replay failure, full checks and property tests pass.
  Existing broker-record compatibility is unproven; no real payment records were
  queried, no expiry rule was invented, and Python production code is unchanged.
- #2550's `/v1/downloads/authorize` derives viewer only from a verified service JWT
  with environment-aware `<track namespace>.download.authorize` and coordinator
  audience. It verifies current canonical CID and supporters policy and returns
  a short-lived decision, never a media URL/capability. Effective moderation and
  playback plus protected access remain mandatory in the client. Owner-only and
  unknown gates, Space-only records and inaccessible legacy gates remain open gaps.
  Actual HTTP tests prove stalled-identity timeout, responsive health, single
  admission and released slot. Expired-budget supporter-port tests prevent fresh
  fallback work; no actual stalled-supporter HTTP claim is made. Incomplete upstream
  checks yield 503, not a definitive denial. See `next/backend/docs/download-policy.md`.
- Historical policy reconcile: 461 verified, one absent, 16 retryable, two
  rejected. One rejection failed the official signature verifier with a fresh DID
  key; the second reason was unavailable after log retention. Complete backfill is
  not proven. The temporary reconcile machine was removed.
- Private metadata CAS remains a protocol gap in the inspected Spaces API. Do not
  invent an ignored `swapRecord` parameter or call a preliminary read atomic.
- Public guides/images continue describing production until cutover. Their audit
  checklist is already in the checkpoint. App Store replacement, production
  cutover and legacy retirement are not authorized by this handoff.

## local state and user handoffs

The goal tool reports `paused`. The main user checkout's unrelated `.cloudflare/`
and `backup*site.standard.document*.json` files were left untouched. User hot-reload
sessions must be preserved. Cutover and parity closed their owned local watcher/
build blocks. Parity restarted the existing disposable `backend-test-redis-1`
on port 6380 for tests and left it running; do not remove a shared service blindly.

Native cleared its synthetic fixture with zero writes, terminated only its own
`fm.plyr.next` app, and stopped Metro 8548/API 8547. Both ports were verified empty;
all owned local processes are stopped. Simulator
`61944C08-03FB-4D9B-A43D-9C0DCC0A9F48` (plyr-next-acceptance, iPhone 17 Pro/iOS 26.5)
and its installed dev binary were preserved. Do not shut down or delete it.

After an explicit resume and host unlock, the preference fixture can be restarted
in owned Rex windows within session `01a1cf0d-32a5-774b-ae5d-a17384f72df1`:

1. In `/tmp/plyr-download-preferences-native`, run `node api.cjs > api.log 2>&1`.
   Keep this read-only fixture; do not substitute an unrestricted mutation proxy.
2. In `next-download-preferences/plyr.fm/next/app` under the worktree root, run
   `EXPO_PUBLIC_API_URL=http://127.0.0.1:8547 npx expo start --dev-client --port 8548 --clear`.
3. Launch the installed `fm.plyr.next` on the preserved simulator. Once its Hermes
   target is ready, the synthetic setup is
   `node /tmp/plyr-native-remote-controls/native-storage-probe.cjs /tmp/plyr-download-preferences-native/setup.js`.
4. Use CUA for actual UI actions; mounted-handler invocation is not device
   acceptance or an unlock workaround. Finish #2539, then switch the owned Metro
   source/fixture for subsequent native gates. Clear the exact synthetic fixture
   with its `reset.js` before teardown.

The detailed native pause receipt and closed Rex block IDs are in
`/tmp/plyr-native-pause-handoff.md`.

The Mac was locked, with no user reply to the unlock request. Do not repeatedly
poll or bypass the lock with alternate UI control. Real-account OAuth is also
pending in the existing Chrome handoff tab `1643900252` at
`https://next.plyr.fm/login?return_to=%2Fportal`; no credentials or grants were
submitted. Keep those acceptance limits explicit.

Local evidence includes `/tmp/plyr-upload-processing`,
`/tmp/plyr-protected-download-evidence.md`, `/tmp/plyr-protected-download-cancel.log`,
`/tmp/plyr-original-download-evidence.md`, `/tmp/plyr-attested-{test,negative}.log`,
and `/tmp/plyr-download-auth-{check,http,property,negative}.log`.
These paths are supplemental local evidence, not substitutes for committed tests
or current workflow results on resume.
