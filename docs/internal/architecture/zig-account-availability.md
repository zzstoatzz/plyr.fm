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

## reconciliation runtime

`MODE=account_reconciler` is a separate process role. It does not run inside
the API or signed-firehose processes. `plyr_index.account_status_checks` stores
only operational scheduling state: the next attempt, most recent relay hint,
lease, attempt/failure counters, response classification, and completion time.
It is not account truth.

Each worker atomically claims one due DID with `FOR UPDATE SKIP LOCKED`, records
the attempt time before network I/O, and holds a renewable-by-expiry lease. A
crashed worker's DID becomes claimable after the configured lease window.
Completion requires the exact attempt and lease, so a late worker cannot
overwrite its successor. A hint arriving during an in-flight request remains
due after completion rather than being postponed by the ordinary interval.

Relay `#account` events for repositories with authenticated heads only move the
schedule forward; they never write availability and failure to record a hint
does not reject the relay frame. Every five minutes the reconciler seeds missing
schedule rows from authenticated repository heads, making hints a latency
optimization rather than a correctness dependency. Transport failures and
non-authoritative statuses retry on the shorter interval without changing
canonical evidence.

## intentionally open

REST composition remains open. Artist, album, and track reads should join this
fact by DID and distinguish account availability from media-delivery
availability, moderation, discovery policy, and viewer authorization.

## measured cost

The production-shaped linux/amd64 ReleaseSafe image is now 35,272,654 bytes and
contains a 13,013,792-byte executable. Adding the durable schedule,
separately supervised reconciler, relay-hint adapter, and runtime configuration
to the preceding availability artifact added 51,104 image bytes and 186,560
executable bytes. The cold Docker compile completed in 319.5 seconds, within the
previously recorded 314.8–337.4-second range; generated grapheme data remains
the dominant cold-build cost.

The host ReleaseSafe reconciler used 3,008 KiB RSS while idle and 13,392 KiB
after one real DID resolution, pinned-TLS current-PDS request, Postgres evidence
write, and lease completion. The loaded figure retains the CA bundle and is
34.8 times smaller than the previously recorded 466.1 MiB complete FastAPI
process, though that is a process-footprint comparison rather than functional
parity. The worker is sequential and has no in-memory queue, Redis dependency,
or unbounded task creation; Postgres leases are its work bound.
