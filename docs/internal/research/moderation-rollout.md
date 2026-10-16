---
title: "moderation refresh rollout and admission criteria"
---

# Moderation refresh rollout

As of October 16, these changes are proposals unless a deployment is explicitly
recorded below. Green CI does not establish live enforcement. The unknown-artist
gate stays closed during this rollout; no census result authorizes ingestion.

## Changes and order

| Change | PR | Deployment prerequisite and evidence |
|---|---|---|
| Reject non-authoritative label/override snapshots | #2149 | Merged; staging v648 verified. Production backend promotion outstanding. |
| Private exact-URI indexing decisions | #2150 | Shared production service approval; deployed endpoint must return an explicit entry for every requested URI. |
| Enforce decisions before track mutations | #2151 | Deploy #2150 first, then retarget/merge to main for staging. Verify exclusions and authority failures before production promotion. |
| Read-only bounded census | #2152 | Retarget after parent merge. Preserve reports on exit 1 and compare findings, not timestamps. Daily heartbeat already configured. |
| Durable, ordered label replay | #2153 | Separate shared-service rollout. Verify replay, reconnect, and backend consumption; JSON remains unchanged. |
| CBOR-capable backend consumer | #2154 | Deploy to staging and production before switching any producer to CBOR. Legacy JSON remains accepted. |
| Current copyright negations | #2155 | Separate shared-service rollout. Check reassertion query and review lists; no historic scan flags are automatically repaired. |

These branches are stacked. After each squash merge, rebase/retarget the next PR
and inspect its effective diff before merging; do not accidentally include an
unapproved parent or deploy backend enforcement ahead of its endpoint. The
moderation workflow deploys shared production on a service-path main commit.
Backend main deploys staging, and production uses the approved release workflow.
Never deploy from a local checkout.

## Apply the 42 exclusions

Use `2026-10-16-indexing-exclusions.json` as the exact subject list. Authenticate
with `MODERATION_AUTH_TOKEN`; never log it. Query `/internal/indexing-decisions`
first and retain the complete response. Record only missing exclusions through
`POST /internal/events`, with action `indexing_exclude`, the exact subject URI,
a truthful operator/delegated actor, and the manifest's reason. Do not overwrite
a later explicit clear without checking its provenance. A timed-out write has
an unknown outcome: query current state before retrying rather than appending
blindly. Retain the returned event IDs as rollout evidence.

Read all 42 decisions back and verify each is excluded. A decision alone is not
enforcement: verify the running backend includes #2151 and the corresponding
URI is still absent from the index. Only then update the manifest's enforcement
status. Future records from either account remain outside this instruction.
No public labels, takedowns, review closures, or transparency posts are required.

If the authority fails, ingestion should fail before mutation and retry within
its bounded policy. Exhausted retries need reconciliation, not a claim that all
records eventually arrive. Clearing an exclusion removes that one block; it is
not an admission approval. Existing indexed-policy conflicts need investigation,
not automatic deletion.

## Verification and rollback

Capture service/backend image SHAs, workflow runs, health, and before/after
policy snapshots. Test endpoint auth, full response coverage, and readback;
verify staging ingestion against an explicitly designated test subject before
production. Never use one of the 42 excluded real records as a smoke upload or
trigger external scans/notifications to prove a guard.

The local regressions cover create, pending finalization, update, deletes,
unknown artists, authority outage, malformed snapshots, and exact-URI scope.
Live evidence must establish deployed versions and a working authority; local
regressions alone do not prove the release is functioning.

Do not roll back the policy API while an admission consumer depends on it.
An unavoidable authority rollback should stop ingestion rather than bypass the
check. Existing labels and decisions are append-only evidence; code rollback
must not delete them. The added nullable context column can remain on rollback.
Any future CBOR producer rollback can restore JSON because #2154 accepts both.

## Before admitting unknown publishers

The desired use case is a valid public record authored directly on a PDS,
without prior plyr.fm login. Login is not evidence that content is safe.
Enabling that use case needs these conditions together:

- Store a bounded metadata candidate keyed by URI and current CID, with source
  and observation time. No public track, media download, vendor scan, notification,
  or public assertion occurs merely because discovery saw it.
- Reserve global and per-DID/PDS budgets before expensive work: record count,
  bytes, duration, concurrent jobs, vendor cost, and retries. Saturation leaves
  candidates held and observable. It never converts a hold into a pass.
- Re-read the live PDS record and private indexing policy before admission.
  Tie assessment and any private approval to the actual record/media version.
  A changed version invalidates approval; unavailable evidence retains the hold.
- Define the relevant content checks and failure behavior. Copyright matching
  alone cannot establish general safety. A missing label or label retraction is
  not an approval. A stale CID-bound label needs review, not silent removal of
  its existing protective behavior.
- Publish only after the admission decision is durable. Public discovery, radio,
  direct media access, mirroring, and notifications must respect that state.
  Show backlog age, volume, failures, and policy conflicts before lifting limits.

The present patches establish exclusion and observability foundations; they do
not implement this held-candidate workflow. Do not remove the known-artist gate
as part of these PRs. Nine unexplained census gaps also remain investigations,
not a backfill list.
