---
title: "Zig account-availability evidence boundary"
---

## decision

Account availability is an independently attributed, rebuildable fact keyed by
the repository DID. It is not a flag on an artist row, and a relay's `#account`
event is not authoritative evidence about the account's current PDS.

Two sources may currently produce canonical evidence:

1. a cryptographically verified repository commit or complete snapshot proves
   that the repository was available when it was authenticated;
2. `com.atproto.sync.getRepoStatus`, fetched directly from the PDS named by the
   current DID document, can prove availability or an account-level unavailable
   state.

Transport failure means no new evidence. It must never mean deletion.

## status semantics

An active current-PDS response is authoritative availability. An inactive
response is authoritative unavailability only for `deactivated`, `deleted`,
`takendown`, or `suspended`. `desynchronized` and `throttled` describe hosting
infrastructure rather than account intent. Missing and unknown future statuses
also produce no projection change.

Responses must repeat the requested DID exactly. Active responses carrying a
status, inactive responses carrying a repository revision, malformed JSON, and
invalid TIDs are rejected rather than normalized into a misleading state.

The direct status adapter follows the repository-repair threat model: resolve
the current DID document, require an HTTPS origin, classify every DNS answer,
pin the checked address while retaining the hostname for TLS/SNI, disallow
redirects, bound the JSON response to 64 KiB, and compare the response DID.
The DID is query-encoded so a literal percent sign in `did:web` is preserved.

## persistence and ordering

`plyr_index.account_availability` records availability, an optional
account-level reason, evidence source, optional repository revision and commit
CID, optional current-PDS origin, and observation time. Check constraints repeat
the legal evidence shapes. There is no dependency on the legacy `artists`
table.

Evidence replaces an older observation, replays exactly, and rejects a
different claim at the same observation time. Older observations are stale.
The observation time for a current-PDS request must be captured before the
request begins, so a slow response cannot overwrite repository activity that
was verified while the request was in flight.

Verified commit and snapshot stores write availability inside the same
transaction as selected records and the authenticated repository head. Tests
prove that a later projection conflict rolls all of them back together. The
real Alembic upgrade and downgrade are exercised against `relay_test`.

## intentionally open

Relay account frames still only advance the relay checkpoint. They will become
deduplicated hints to a separately supervised current-PDS checker; they will
never write this table directly or make the signed firehose loop wait on an
untrusted PDS. A periodic reconciliation sweep is also required so a dropped
hint cannot leave availability stale forever.

REST composition remains open. Artist, album, and track reads should join this
fact by DID and distinguish account availability from media-delivery
availability, moderation, discovery policy, and viewer authorization.

## measured cost

The production-shaped linux/amd64 ReleaseSafe image is 35,221,550 bytes and
contains a 12,827,232-byte executable. Relative to the preceding verified
profile artifact, the availability model, strict status decoder,
destination-safe current-PDS adapter, Postgres adapter, and transaction wiring
added 10,186 image bytes and 37,352 executable bytes. The cold Docker compile
completed in 314.8 seconds, below the previously recorded 337.4-second Unicode
build; generated grapheme data remains the dominant cold-build cost.

No background checker is running in this artifact, so this slice adds no idle
network requests, queue, thread, or Redis dependency. Its steady-state cost is
one monotonic Postgres upsert inside an already-open verified commit or snapshot
transaction. End-to-end checker throughput and memory belong to the worker
slice, where they can be measured rather than guessed.
