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
The stopped machine is retained for diagnosis; the cause is not yet established.


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
run `38957545171` follows this cache repair.

Nate noticed that the working embed fallback was visibly grainy: it expanded a
96px thumbnail ahead of available 1024px album art. #2159 corrects that priority.
Nate also reported queue artist links stopping playback; #2160 lets those clicks
reach the client router without invoking row playback and protects focused links
from row keyboard shortcuts. Local browser navigation preserved the current
source and advanced from 0:57 to 1:09. These are frontend-only follow-ups.

The separate repeated For You continuation report is tracked in #2158. Existing
code already shuffles candidates, so its investigation must trace the actual
queue/cache/restore path rather than assume shuffle is absent.
