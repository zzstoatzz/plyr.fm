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
run `38954596566` is pending verification. Production backend enforcement is
not yet live.

The standard `just release` also includes unreleased equalizer audio-proxy code
from #2134 and frontend embed-artwork fallback #2138. Those changes are outside
the scoped approval. A separate question is pending about an isolated moderation
release versus approving the existing main bundle. Do not interpret the initial
approval as approval of that additional code.

Staging's app machine became unresponsive during preflight, before #2151's
deployment: its public health request timed out and Fly SSH panicked during
container selection. Production SSH worked. Policy verification and writes ran
from the production app using its existing moderation credential; the credential
was never exported or printed. Staging must recover and validate before promotion.
