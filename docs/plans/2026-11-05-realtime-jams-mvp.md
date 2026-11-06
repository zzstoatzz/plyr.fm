# Real-time playback and Jams MVP

The user authorized implementation and deployment to Next. HA and snappy interactions
are MVP requirements. Build the working end-to-end path first, then adversarially
review and clean up. No production promotion.

## MVP

- Creator-owned private Space creates/invites the room; client keeps OAuth sessions.
- Join uses a narrow service-auth JWT for identity and a one-use Space delegation
  token for current read admission. Coordinator never holds the user's OAuth session.
- Two Zig coordinator instances share Redis. Atomic state/revision/dedup/event commit;
  instance-local sockets receive cross-instance events. Fresh snapshot on reconnect.
- Participants play/pause explicitly and edit queues; only host seeks. All playback
  controls use one solo/Jam gateway. No local guest seek followed by polling snapback.
- Redis clock anchors playback. Immediate local scrub preview, coalesced committed
  seeks, bounded peer queues and write timeouts. No Docket in interactive path.
- Browser protected audio streams authorized ranges instead of waiting for a full Blob.

## Sequence

- [ ] Working coordinator, Space admission and Redis state across two local instances.
- [ ] RN room + root playback gateway + host/guest controls work end-to-end.
- [ ] Range-delivered protected audio and smooth seek feedback work in real browser media.
- [ ] Test concurrent pause, stale seek, same-track occurrences, reconnect to the other
      instance, slow peers, forbidden access and credential renewal. Measure latency/bytes.
- [ ] Review implementation for unnecessary machinery, races, memory/queue bounds and
      integration duplication; fix findings rather than broadening the feature set.
- [ ] Atomic green PRs, Next-only deployment with two live coordinators, then independent
      browsers against real PDS Spaces and real audio. Verify normal production unchanged.

## Deliberately deferred

Leader election/leases, generalized distributed actors, arbitrary historical replay,
Docket adoption, SDK/MCP, cutover work, UI reskins. Redis serializes state, so a room
owner process and a separate fencing subsystem are unnecessary for this MVP.

## Availability and storage

Two always-running coordinators in IAD share `plyr-redis-jams-next`, colocated
in IAD. They do not use the existing Next cache: that machine has no volume,
no persistence and allkeys-lru eviction. Jam Redis has a 1 GB volume, AOF with
appendfsync always, and noeviction. Commands fail closed on Redis errors.
This provides coordinator process failover, not uninterrupted service through
loss of the Redis primary or its volume. Admission and reconnect recheck Spaces.
An idle room expires after 24 hours; restart after missing state creates a new epoch.

The incremental always-running footprint is three shared-cpu-1x 256 MB machines
and one 1 GB volume: about $6.72/month before egress and snapshot storage, using
the [current machine pricing](https://fly.io/pricing/) ($2.19 each) and
[volume pricing](https://fly.io/docs/about/pricing/) ($0.15/GB-month), checked
2026-11-05. This is additional to the existing Next API/ingester/Neon footprint.

## State

Local ReleaseSafe Redis sequencing measurements (128 samples, real TCP Redis,
independent producer/consumer connections and a concurrent blocking reader):
one-track request to fresh state p50/p95 0.422/0.477 ms; 200-track queue
2.735/2.852 ms. These exclude WAN, WebSocket delivery, rendering and admission.
Actual two-browser cross-instance UI play delivery measured 17–27 ms locally.
Browser testing also caught a press/release race: the displayed Pause action
must retain its desired intent and revision while a remote update arrives.

The research source is docs/research/2026-11-05-spaces-realtime-playback.md. The running
room currently polls host snapshots; the new coordinator seeds from the authenticated
host's initial queue after validating Space admission. No implicit server-side PDS
writes are introduced. Coordinator state is operational state, separate from the
read-only catalog appview. Both coordinator instances must be interchangeable.
