---
title: "Zig background-work boundary"
---

## decision

Redis and Docket remain part of plyr.fm. They are durable operational
infrastructure, not legacy dependencies to be removed with FastAPI. The Zig
REST application depends on a purpose-specific asynchronous-work port; it does
not expose Redis commands or Docket execution objects to HTTP handlers.

The existing Python and Zig Docket implementations share a design lineage but
not a Redis wire protocol:

| property | pydocket 0.17.3 | Zig Docket 0.0.1 |
|---|---|---|
| arguments | cloudpickled `args` and `kwargs` | JSON `params` |
| scheduled score | Unix seconds | Unix microseconds |
| execution state | claim, progress, cancellation, retry, result lifecycle | smaller schedule, promote, consume, acknowledge lifecycle |
| parked key | `{name}:{task_key}` | `{name}:parked:{task_key}` |

They must never consume the same stream or share a Docket name. During the
migration they may use the same authenticated Redis deployment, with separate
key prefixes:

- `plyr` remains owned by the Python pydocket workers;
- `plyr-zig` is reserved for Zig producers and workers;
- an environment may add a suffix when Redis itself is not already isolated.

This is stronger than hoping that similar Lua scripts imply compatibility. A
message acknowledged by the wrong runtime can become silent data loss.

## application boundary

REST use cases submit typed commands such as `mirror_blob`, `analyze_audio`, or
`publish_record`. The port returns a stable operation identity and one of three
outcomes: accepted durably, already accepted under the idempotency key, or
unavailable. HTTP handlers do not choose Redis keys, task function names,
serialization, retries, or worker concurrency.

A request that requires durable asynchronous work must not report success when
the queue is unavailable. The API either completes the authoritative action
synchronously or returns a failure without claiming that work was accepted.
Long-running commands are represented by operation resources whose state can be
reconciled from their authoritative side effects.

The queue carries stable identifiers and small primitives. Audio, images,
credentials, local paths, and database model snapshots do not cross it. Media
is staged to R2 or a PDS blob service first; a task receives the content
identity and staging reference it needs to resume on another machine.

## Redis boundaries

Redis serves several independent purposes and each gets its own adapter and
failure policy:

- Docket provides durable asynchronous execution;
- session caching accelerates encrypted Postgres-backed session lookup;
- rate limiting enforces request policy with an explicit degraded mode;
- streams coordinate realtime workflows such as jams;
- short-lived deduplication and tombstones protect ingestion races.

There is no application-wide `RedisStore` abstraction. A queue outage, cache
miss, and rate-limit storage outage have different correctness implications and
must not collapse into the same fallback behavior.

## deployment prerequisite

Plyr's Fly Redis requires a password. The Zig Docket checkout originally
discarded Redis URL credentials and database selection even though its Redis
client supported `AUTH` and `SELECT`. Local Docket commit `76762dc` fixes full
`redis://[username:password@]host[:port][/db]` handling, preserves auth and DB
selection across reconnects, zeroes the owned password on shutdown, and tests
against password-protected Redis on a non-default database.

That commit is intentionally not yet a plyr dependency: it must be published
and pinned before the first Zig queue producer or worker is enabled. The
read-only canary does not receive `DOCKET_URL` merely to make configuration look
complete.

## migration sequence

1. Keep the first read-only canary free of Redis and background-work authority.
2. Publish and pin a Docket version with authenticated URL support.
3. Introduce the asynchronous-work port with a Zig-only task and the
   `plyr-zig` namespace; prove enqueue, worker execution, retry, reconnect, and
   idempotency against disposable authenticated Redis.
4. Move a complete command and its worker together. Do not enqueue a Zig JSON
   task for a Python worker or teach Zig to emit Python pickle.
5. Keep the Python namespace until no retained HTTP, ingestion, repair, or
   scheduled workflow produces or consumes it.
6. Remove a Python worker family only after its authoritative side effects and
   failure recovery have semantic coverage in Zig.

Postgres tables, R2 object keys, and task messages remain adapter details. The
domain command names and operation states must survive changes to any of those
physical layouts.
