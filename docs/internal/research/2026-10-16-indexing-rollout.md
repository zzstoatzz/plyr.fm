---
title: "indexing policy rollout evidence"
---

# Indexing policy rollout

Nate approved deploying #2150, then #2151, and recording the 42 exact exclusions.
No account-wide exclusion or public label was requested.

## Shared policy service

- #2150 merged as `3eaf3173fe2ae03d6fe7f3e7d9b412b33af20f7c`.
- Moderation deployment run `38953962779` succeeded; public health returned
  `status=ok` and `labeler_enabled=true`.
- Unauthenticated POST to `/internal/indexing-decisions` returned 401.
- Authenticated preflight returned all 42 requested keys with no prior decision.
- Recorded 42 `indexing_exclude` events through `/internal/events`, attributed
  to `agent:codex:operator-authorized`, with the user's exact-URI instruction.
- Authenticated readback returned all 42 as excluded. The manifest records the
  per-URI event IDs; an independent Neon moderation query confirms IDs 218–259
  and only the `indexing_exclude` action for that actor.
- An independent production database read found zero indexed subjects from the
  exact manifest. This proves present absence, not future enforcement.

## Backend rollout

#2151 was rebased onto the deployed service commit and reran CI successfully.
It merged as `c9ab8ee0284831aedf9969711de4cbb0e369d415`; staging deployment
run `38954596566` succeeded. Staging health returned OK; its deployed guard
returned excluded for all 42 subjects, false for a distinct control URI, and
raised on missing credentials in an isolated verification process. No records
were created or media fetched. Production enforcement was subsequently verified as described below.

The standard `just release` also includes unreleased equalizer audio-proxy code
from #2134 and frontend embed-artwork fallback #2138. Nate explicitly approved this additional bundle and requested smoke testing
and readiness to follow up immediately on any production regression.

Staging's app machine became unresponsive during preflight, before #2151's
deployment: its public health request timed out and Fly SSH panicked during
container selection. Production SSH worked. Policy verification and writes ran
from the production app using its existing moderation credential; the credential
was never exported or printed. The #2151 deployment replaced the unresponsive app machine; staging health and
guard verification then passed before promotion.

## Production release and verification

Release `2026.1016.192720` deployed commit
`c9ab8ee0284831aedf9969711de4cbb0e369d415` in production workflow
`38955043062`. Cloudflare Pages production deployment
`55900588-cf04-413f-9d8b-c486bbd5882c` also succeeded. App, worker, and
Jetstream machines were verified against that image SHA.

The deployed guard was exercised in an isolated process on the production
worker: all 42 exact subjects returned excluded, a different record under the
same DID returned false, and removing the credential in that isolated process
raised rather than allowing admission. No ingestion call or media fetch was
performed by this check. Independent Neon reads still show zero indexed
subjects and exactly 42 private events, IDs 218–259.

The label stream reconnected after deployment and operator-label reconciliation
reported its projection in sync. Scan/embedding failures for track 1448 began
before this release; they are not evidence of a release regression.

Production smoke checks confirmed public playback, anonymous denial of the
signed-in-only track (including `cors=1`), and embed 1227's thumbnail fallback
at 390px and 1280px widths. A full private-media production browser run first
failed during an API-machine stall; its test track 1450 was cleaned up.
The retry and authenticated equalizer coverage are tracked in #2157.

API machine `91859e9f9e1908` stopped answering health checks after deployment
and did not recover promptly after restart. Replacement `8911135fed76d8`
was cloned from healthy `80ee112a6274e8`, preserving the deployed image and
configuration, and passed health checks before the stalled machine was stopped and cordoned.
The stopped machine is retained for diagnosis. A subsequent staging stall was
captured with py-spy: SlowAPI was blocked in synchronous Redis `evalsha` on the
main event loop, with no socket timeout. The machine had available memory. #2161
adds bounded Redis reads/connections and offloads default and decorated endpoint
limit checks; this addresses a demonstrated mechanism capable of causing these
API-wide stalls, rather than asserting the uncaptured production stack was identical.


## Smoke-test findings and follow-ups

The production private-media run `38957118611` passed private upload,
cross-account admission/revocation, fresh-session playback, and private voice
memo creation/playback, with test-record cleanup. Its equalizer step exposed
missing CORS headers on an older cached public audio response at the CI
runner's Cloudflare edge. This was a real playback failure when EQ was enabled,
not an authentication failure.

Cloudflare CLI verified that `audio-prod` already had the committed public CORS
policy. A host-scoped purge for `audio.plyr.fm` in zone
`2bfcb9ffe7847604e9febbb62d9649a3` succeeded; a fresh 206 response for the same
object included `Access-Control-Allow-Origin: *`, including with `Origin: null`.
The private buckets and media objects were not modified. Production verification
run `38957545171` passed public EQ playback after this cache repair, but its
gated-track check timed out. Both gated HEAD requests returned 200 in under
30ms; the player instead returned to its previous public track. Run `38959167060`
waits for queue restoration before the gated playback check to isolate EQ from
that suspected queue race.

Nate noticed that the working embed fallback was visibly grainy: it expanded a
96px thumbnail ahead of available 1024px album art. #2159 corrects that priority.
Nate also reported queue artist links stopping playback; #2160 lets those clicks
reach the client router without invoking row playback and protects focused links
from row keyboard shortcuts. Local browser navigation preserved the current
source and advanced from 0:57 to 1:09. These are frontend-only follow-ups.

The separate repeated For You continuation report is tracked in #2158. Existing
code already shuffles candidates, so its investigation must trace the actual
queue/cache/restore path rather than assume shuffle is absent.


The replacement staging API `85e206b47e65e8` temporarily uses 2GB; this was a
recovery experiment before the Redis stack capture, not evidence that more
memory is required. Reconcile it to the committed deployment configuration.
Staging Redis restarted at 19:54Z and Docket logged connection resets; staging
run `38958122393` failed waiting for uploads to finish. Exact test record 10134 (`e2e private 1792180117370`) was cleaned up through
the authenticated staging DELETE endpoint, which returned 200; no broad database
or PDS deletion was used.


## Final verification and outstanding infrastructure work

Production browser run `38959791716` passed private upload, access/revocation,
voice memo, public EQ, gated EQ and the exact 100-byte authenticated range check.
Both test records (1462, 1463) were deleted successfully. A later staging private
media run, `38959993366`, also passed with the new limiter on the serving machines.

The first public cache purge was not durable: run `38959167060` reproduced the
missing header. A Cloudflare response-header transform now sets wildcard ACAO
only on `audio.plyr.fm`, including cache hits and requests without Origin.
Ruleset `5b01868a48234413a3984f489720e2d1`, rule
`a5afef9551124993b4cd42ce1d4e646b`, is recorded with rollback guidance in #2157.
Cache HIT range requests with absent, app, and null Origins all returned 206,
100 bytes and exactly one wildcard ACAO. Private buckets were not changed.

Frontend-only promotion of `0c7c046cf129053da4189b5fb61d7da72c4a9b01` succeeded
in Pages deployment `69aca364-60b8-40bc-b1b4-0741a43c761b`; the Tangled mirror was
retried successfully after a concurrency-limit rejection. Production embed 1227
loaded 1024x1024 album art. Clicking the upcoming queue row's artist opened
`/u/zzstoatzz.io` while the same audio continued from 6 to 17 seconds. Playback
was paused after verification. #2162 separately tracks a suspected late queue
restoration overwriting a user's newer track selection.

The production backend is still release `2026.1016.192720` at `c9ab8ee0`.
#2161 is merged and running on staging's serving processes, but its complete
staging deployment is blocked by Fly control-plane token-verification timeouts:
first on a stopped standby, then on creating the release-command machine.
Fly's status page reports platform-wide rolling host reboots. No production
backend promote was attempted during that instability. Both staging API machines
were reconciled to the committed 1GB configuration by the partial deployment.

Next operational step: once Fly is stable, complete a green staging deployment,
then run the already-authorized full fast-follow release of #2161 and smoke it.
Reconcile the temporary/replaced API machines after that succeeds; do not delete
healthy serving capacity during the incident. The remaining moderation replay,
CBOR consumer and negation PR stack (#2152–#2155) remains unpromoted.
