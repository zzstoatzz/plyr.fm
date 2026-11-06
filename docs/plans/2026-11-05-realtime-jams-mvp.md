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

- [x] Working coordinator, Space admission and Redis state across two local instances.
- [x] RN room + root playback gateway + host/guest controls work end-to-end.
- [x] Range-delivered protected audio and smooth seek feedback work in real browser media.
- [x] Test concurrent pause, stale seek, same-track occurrences, reconnect to the other
      instance, slow peers, forbidden access and credential renewal. Measure latency/bytes.
- [x] Review implementation for unnecessary machinery, races, memory/queue bounds and
      integration duplication; fix findings rather than broadening the feature set.
- [x] Final completion audit after atomic green PRs and Next-only deployment: independent
      browsers against real PDS Spaces and decoded audio, real coordinator failure,
      and unchanged normal production. See [completion audit](../research/2026-11-06-jams-live-verification.md).

## Deliberately deferred

Leader election/leases, generalized distributed actors, arbitrary historical replay,
Docket adoption, SDK/MCP, cutover work, UI reskins. Redis serializes state, so a room
owner process and a separate fencing subsystem are unnecessary for this MVP.

## Spaces library boundary

Implement the application flow first, then evaluate extraction from working code.
Reusable Space credentials/delegation, signatures, MAC verification and typed
protocol calls are candidates for ZAT. Jam policy, playback semantics, Redis
coordination and React state stay in plyr. Keep those layers separate now; do
not block the MVP on a new generic Spaces framework or move code speculatively.
The pinned ZAT JWT parser normalizes `typ` to `JWT`; admission therefore checks
the signed raw header to distinguish identity JWTs from Space delegation tokens.
Preserving that distinction is a requirement for any later typed ZAT helper.

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
Idle live coordinator processes used about 11 MB RSS and 11 threads each after
deployment; that is an idle observation, not a maximum-load memory claim.

## State

The coordinator implementation merged as #2422 after Linux build/test, Redis/Postgres
tests and property harnesses passed. Adversarial testing then exposed two WebSocket
v0.2.0 failures: final close racing an active writer (BADF), and socket timeout
EAGAIN reaching a std.Io programming-error panic. #2424 pins reviewed upstream
fixes with real partial-write and timeout regressions. Full upstream suites pass
(72 nonblocking, 70 blocking), as does the real two-coordinator slow-reader test:
200 tracks, 53 KB snapshots, 110 commands at 22 Hz; the slow peer is disconnected
while the active peer stays connected, with local delivery p95 10.2 ms.

#2425/#2426 remove a duplicate image build/upload and deploy the API and coordinator
from one immutable image. The image-resolve/deploy step bundles the two existing
app-scoped Fly tokens in memory; other steps retain their single-app credential.
The isolated persistent Redis is deployed and its live configuration was verified.

Local ReleaseSafe Redis sequencing measurements (128 samples, real TCP Redis,
independent producer/consumer connections and a concurrent blocking reader):
one-track request to fresh state p50/p95 0.422/0.477 ms; 200-track queue
2.735/2.852 ms. These exclude WAN, WebSocket delivery, rendering and admission.
Actual two-browser cross-instance UI play delivery measured 17–27 ms locally.
Browser testing also caught a press/release race: the displayed Pause action
must retain its desired intent and revision while a remote update arrives.

Final local client acceptance uses two independent Chrome processes, real browser
OAuth/Spaces and actual public audio. Held duplicate Pause, canceled presses,
keyboard activation, rapid host scrubbing and guest seek gating passed. Steady
playhead separation was at most 223 ms after startup correction; post-seek at
most 26 ms. Actual coordinator SIGKILL re-admitted through the surviving instance
in 338 ms without replacing the audio source, with at most 33 ms post-failover
drift. Switching to radio leaves locally without sending a Jam pause to peers.
These are local acceptance measurements, not a public network guarantee.

Public Next acceptance on 2026-11-06 used two independent Chrome processes,
actual OAuth and creator-owned Spaces on pds.zat.dev, native browser WebSockets,
and actual Sounds of the Drone Mix audio. Initial TCP inspection verified one
browser socket on each Fly machine. A complete second run passed create/invite/
join, held duplicate Pause, canceled-press accessible activation, keyboard Play,
rapid host seeks, guest seek restrictions and Jam-to-radio switching. UI play
delivery was 254 ms; post-seek playhead separation stayed within 10 ms.

The live failover barrier let the operator verify established sockets, cordon and
SIGKILL their hosting machine, then verify both sockets on the surviving machine.
Both browsers re-admitted, retained the same room epoch and audio source, and
stayed within 18 ms after failover; guest Pause reached the other UI in 105 ms.
The barrier's operator wait is not a reconnect-latency measurement. Both machines
were restored afterward. An earlier run's final UI step found that the test sent
Escape before the player dismissal was ready; the harness now closes through
the visible control and verifies the dialog is gone before continuing.

Production frontend revision remained 99334ecb0830fcd8eef411dad35f857361f48d43;
production web/API health checks stayed 200. No normal production promotion ran.

#2428 fixes the radio handoff guard to read live player state rather than a stale
React status after Expo replaces a media element. Local acceptance requires
decoded, non-seeking audio and passed on an MPEG source. The fix's public Next
deployment passed before the user requested a pause. The resumed public rerun
on November 6 passed decoded radio playback and the full completion audit.
#2429 additionally fixed web slider feedback loops and solo seek-release rollback.
Chromium ALAC compatibility is a separate known issue (#2427, following #1595),
not claimed fixed.

The research source is docs/research/2026-11-05-spaces-realtime-playback.md. The old
room polled host snapshots; the new coordinator seeds from the authenticated
host's initial queue after validating Space admission. No implicit server-side PDS
writes are introduced. Coordinator state is operational state, separate from the
read-only catalog appview. Both coordinator instances must be interchangeable.
