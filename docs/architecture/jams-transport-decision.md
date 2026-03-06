---
title: "jams transport layer decision: Redis Streams"
---

## status

recommended for implementation in jams v1.

## decision

use **Redis Streams** as the transport for jam state fan-out and reconnect catch-up.

## why this decision

### 1) reconnect behavior matters most on mobile PWA

mobile websocket disconnects are normal (backgrounding, network handoffs, weak signal). streams let clients resume from `last_id` and replay only missed updates instead of forcing a separate full-state sync flow every reconnect.

### 2) one code path for live + catch-up

with streams, the same primitive (`XREAD`) handles:
- live updates while connected
- short reconnect gaps
- late join bootstrap from latest snapshot event

that is simpler to reason about than pub/sub plus a separate state hash sync contract.

### 3) queue updates are order-dependent

play/pause/seek is mostly last-writer-wins, but queue operations (add/remove/reorder) are order-sensitive. streams provide strict per-stream ordering with message ids.

### 4) streams are already a production pattern here

this is the key correction from earlier assumptions: Docket already uses Redis Streams heavily.

- stream/group setup: `backend/.venv/lib/python3.14/site-packages/docket/docket.py`
- `XREADGROUP` / `XAUTOCLAIM` worker loop: `backend/.venv/lib/python3.14/site-packages/docket/worker.py`
- `XADD` in scheduler pipeline: `backend/.venv/lib/python3.14/site-packages/docket/worker.py`

so streams are not new operational territory for this stack. pub/sub also exists in Docket, but mainly for cancellation signaling, not the main work queue.

## v1 design sketch

### key model

- stream key: `jam:{jam_id}:events`
- trimming: `MAXLEN ~ 1000` (tunable)
- payload strategy: emit **authoritative snapshot events** (not tiny diffs)

snapshot payload fields (example):
- `revision` (monotonic server integer)
- `track_file_id`
- `progress_ms`
- `is_playing`
- `updated_at`
- queue snapshot or queue revision pointer
- actor metadata (`did`, command type)

### websocket protocol

client hello:
- `{ "type": "sync", "last_id": "<redis-stream-id-or-null>" }`

server behavior:
1. if `last_id` is present and still retained, replay `(last_id, +]` in order.
2. if `last_id` missing or trimmed, send latest snapshot event via `XREVRANGE ... COUNT 1`.
3. then continue tailing for new events.

### publish path

on authoritative jam command (play/pause/seek/skip/queue mutation):
1. validate + apply server state mutation
2. increment `revision`
3. `XADD jam:{id}:events MAXLEN ~1000 * fields...`
4. fan out to connected ws clients

### read/tail pattern

- no consumer groups for jam fan-out
- each connection tracks its own offset (`last_id`)
- use blocking `XREAD` loop per active jam reader task on each backend instance

consumer groups are unnecessary here because this is broadcast, not work distribution.

### conflict and idempotency rules

- `revision` is the source of truth; clients ignore stale revisions
- operations are server-authoritative; client commands are requests, not direct state writes
- reconnect replay can safely include already-applied revisions

## trade-offs accepted

- higher implementation complexity than bare pub/sub
- bounded storage overhead for recent history
- need explicit trimming policy and fallback when requested `last_id` has been trimmed

these are acceptable given the reconnect reliability gains and the existing Docket stream precedent.

## non-goals for v1

- no long-term jam event history product surface
- no consumer-group coordination
- no cross-jam analytics pipeline from this stream

## rollout and safeguards

1. ship behind feature flag for jams.
2. instrument:
   - reconnect count per session
   - replayed event count per reconnect
   - trimmed-last-id fallback count
   - end-to-end command-to-fanout latency
3. set alert thresholds if fallback frequency or fanout latency spikes.

## fallback plan

if stream-based fan-out shows unacceptable operational behavior, fallback is pub/sub + explicit snapshot sync endpoint/message. this keeps product behavior intact while changing transport internals only.
