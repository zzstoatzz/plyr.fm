# Personal queue continuity and synchronization

## Goal

Ship personal queue persistence and continuation to Next, including synchronization
for the same account across all connected clients from the beginning. Jams remain
the many-account shared queue/timeline. Normal production is outside this rollout.
The user explicitly chose shared personal queues over a per-device-only first cycle.

Tracking issue: #2446.

## Behavior to retain

- Explicit picks survive playing a different track or collection. A replaceable
  collection/generated suffix never buries explicit picks. Duplicate occurrences
  have separate identities even when they reference the same authored record.
- Collection playback and optional keep-playing are separate preferences. Clearing
  explicit picks does not veto continuation. Disabling keep-playing removes its
  generated tail, not an album the user deliberately started.
- In-document navigation and account adoption preserve audible playback. Full
  external OAuth navigation restores the intended queue and position paused.
  Account switching/logout cannot expose another account's private state.
- Refresh restores queue/position paused. Restored position earns no listening
  credit. Old media callbacks lose authority after a source or owner change.
- Every client observes queue edits promptly. Shared queue state and local audio
  output are distinct: a remote edit must not start another speaker. Deliberate
  playback transfer must fence the previous output; mere reconnect never claims it.
- Queue exhaustion advances once. Continuation is fetched ahead of time with
  bounded work, cancellable stale results and an explicit terminal/error state.

## Storage and coordination

Use the existing Zig/WebSocket/Redis coordination foundation, not an opaque queue
PUT in the catalog appview. The appview remains read-only for canonical records.
Redis serializes commands and atomically stores revision, dedup and notification.
Personal queue state must survive idle periods; do not inherit the Jam room's
24-hour state expiry. Keep event/dedup retention bounded. Existing persistent
single-primary Redis remains a documented infrastructure limit, not Redis HA.

Use a private, owner-only personal queue session under the existing Space-backed
admission boundary. Enforce owner identity at the coordinator even if a caller
tries to enter it through a normal Jam path. Personal and Jam state cannot mix.
Reserve the `personal-queue` key under the configured Jam Space type for an
owner-only session; reject its use through ordinary Jam admission. Existing OAuth
Space and coordinator grants can authorize the owner without another sign-in.
The coordinator must enforce owner identity independently of Space membership.

Queue runtime state is application coordination data in Redis, not a canonical
PDS queue record. Do not claim portable PDS queue checkpoints in this cycle.
No server-owned OAuth session or per-progress-tick Postgres/network writes.
Bound room references to the existing 200-entry transport contract. Personal state
survives idle time; command and event history stay bounded. Single Redis-primary
loss remains a separate infrastructure limit, as it is for Jams.

Device checkpoints are a fast resume/cache path, never a stale replacement for an
existing account queue. Structure and progress writes must be bounded and isolated
by account. Catalog metadata hydration should batch references; avoid a waterfall
of one request per queue item. Keep playback-resolution URLs and credentials out
of stored snapshots. Admission, media and remote hydration must not block gestures.

The legacy #1919 conflict fix retries a full local snapshot after adopting the
remote revision. Preserve its goal (do not erase a new user action) without
copying its lost-update hazard: shared edits should name queue occurrence keys
and operations, not blindly replace another client's snapshot. #2028 is the
record-identity reference; never substitute audio blob identity for record or
occurrence identity.

## Work chunks

- [x] Preserve the production queue contract in a small occurrence-aware model.
- [x] Extend coordinator admission and state for private personal sessions, stable
      queue intents, output ownership, persistence and cross-instance convergence.
- [x] Batch catalog hydration for referenced queue tracks with existing visibility
      rules, bounded requests and real Postgres endpoint coverage.
- [x] Connect client queue, account transitions and paused restoration to the shared
      session; preserve solo queue around Jam/radio handoffs.
- [x] Add bounded continuation prefetch, repeat/end/error behavior and queue labels.
      Next does not yet have For You; do not label latest-catalog fallback as For You.
- [ ] Adversarial review, concurrency/Redis tests, real decoded-browser verification,
      merge green PRs and verify live on Next with independent authenticated clients.

## References

- [Queue contract](../internal/frontend/queue.md)
- [Player lessons and cycles](../research/2026-11-04-player-lessons-and-core-cycles.md)
- [Spaces coordination research](../research/2026-11-05-spaces-realtime-playback.md)
- [Jam MVP acceptance](../research/2026-11-06-jams-live-verification.md)

The old Jams foundation README describes a pre-coordinator implementation; use the
Zig coordinator and live acceptance document as the current source of behavior.

Implementation and acceptance evidence is recorded in the
[November 7 verification report](../research/2026-11-07-personal-queue-verification.md).
Backend #2447–#2450 are live; final client acceptance and deployment remain pending.
