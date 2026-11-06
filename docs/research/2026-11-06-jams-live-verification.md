# Jam MVP completion audit

**Date:** November 6, 2026. **Environment:** next.plyr.fm only.

The implementation goal is complete. The final public rerun passed after the
radio handoff fix (#2428) and player scrubbing fix (#2429). This establishes the
scoped end-to-end MVP, not full legacy Jam feature parity or a production SLO.

## Final public run

`next/app/scripts/check-jam-realtime.cjs` drove two independent Chrome processes:
1280px/dark host, 390px/light guest. They used actual browser OAuth and
creator-owned private Spaces on pds.zat.dev, native WebSockets to the deployed
coordinators and decoded Sounds of the Drone Mix audio. No PDS/coordinator/media
responses were fixtures. Appview POST requests were blocked so this acceptance
run did not generate application play receipts.

The run passed create/invite/join after sign-in redirects, held duplicate Pause,
canceled-press accessible activation, keyboard Play, rapid host scrubbing, and
disabled guest seeking. Audio assertions required readyState >= 2, non-seeking
media and advancing currentTime, rather than merely an assigned seek target.

| Observation | Measured result |
|---|---:|
| Host Play to guest UI | 187 ms |
| Initial stable playhead separation, maximum of 10 samples | 126 ms |
| Post-seek playhead separation, maximum of 10 samples | 6 ms |
| Post-failover separation, maximum of 10 samples | 7 ms |
| Guest Pause to host UI after failover | 92 ms |

Before failure, TCP inspection showed one established application connection on
each coordinator. Machine `83dd706b772d18` was cordoned and stopped with SIGKILL.
It was verified stopped, and both connections were then observed on survivor
`8111936b9d05e8`. The guest obtained fresh admission and a new socket; both clients
retained their room epoch and original audio element. The operator barrier wait
is not a reconnect latency measurement.

The host then switched to radio. Its old Jam audio stopped, a different radio
media element decoded and played, the guest kept playing, and no shared command
was emitted by the host's departure. Both machines were restored and uncordoned;
all coordinator health checks passed afterward. Test audio stopped when the
browser processes closed.

Evidence on the execution host: `/tmp/plyr-jam-resumed-live.log` and
`/tmp/plyr-jam-resumed-live/{host,guest}.png`. Account credentials stay outside
the repository in the protected disposable-account file; do not print them.

## Requirement audit

| Requirement | Implementation and evidence |
|---|---|
| Creator-owned private room and membership | `jam-space.ts`, real create/invite/join on pds.zat.dev. Sign-in preserves room intent. |
| Client-owned OAuth; verified service admission | `auth.zig` verifies DID signature, token type/audience/method/expiry and Space delegation; exchanges it at the resolved PDS. `check-jam-coordinator.cjs` rejects an uninvited guest. No user OAuth session enters the coordinator. |
| HA coordinator without a room owner lease | Two deployed Zig instances share one atomic Redis state/revision/dedup/event commit. Live cross-instance delivery and verified machine failure passed. |
| Explicit, race-safe controls | `model.zig`, Redis integration tests and live held-Pause race. Epoch, occurrence and expected revision fence old commands; duplicate desired state is a no-op. Only the host seeks; participants can play/pause and edit queues. |
| Recovery without replaying stale intent | `jam-connection.ts` discards unsent commands and obtains new admission/snapshot on reconnect. Its regressions cover stale frames, newer broadcasts, old epochs and coalesced seeks. Live failure retained the room epoch and media source. |
| Clock and seeking | Redis time anchors the timeline; the client estimates clock offset from round trips and applies drift correction independently of command traffic. Local and public two-browser media checks passed. #2429 isolates pointer feedback and retains solo seek preview until media status catches up. |
| Bounded transport and slow-peer isolation | Maximum 200 tracks, 128 configured connections per coordinator, 16 queued frames/512 KiB per peer, independent writers with deadlines. Real 53 KB snapshots at 22 commands/s disconnected the slow peer while the active peer stayed connected; local delivery p95 was 10.2 ms. #2424 fixes the upstream close/timeout failures exposed by that test. |
| Credential and ticket lifetime | One-use Redis socket tickets expire after 30 seconds. Admission lasts at most 10 minutes or credential expiry, whichever is earlier. Expired peers disconnect and reconnect through fresh Space admission. Fresh admission was observed during real failover; this rerun did not wait ten minutes for natural expiry. |
| Private audio stays separate from room access | The room never relays audio credentials or bytes. Record verification and client-owned signed Range delivery are covered by the [private audio report](2026-11-05-private-audio-streaming.md), browser worker tests and real disposable-ZDS owner acceptance. Jam membership grants no additional artist-audio access. |
| Read-only catalog boundary | Operational room state lives in the isolated coordinator/Redis; canonical Space and record writes remain client-to-PDS. No Docket or SQL tick writes in the command path. |
| Storage and cost are explicit | Dedicated persistent Redis uses a volume, AOF/fsync-always and noeviction. The plan records the additional three 256 MB machines and 1 GB volume estimate (~$6.72/month before egress/snapshots, pricing checked November 5). It does not describe the entire Next bill. |
| App-first Spaces support | Application behavior stays in plyr. Protocol credentials, signatures and typed calls are potential later ZAT extractions, after concrete reuse; no new generic framework was added. |
| Production isolation | Product PRs #2421–#2426, #2428 and #2429 merged with relevant CI green and deployed only to Next. Normal frontend remained `99334ecb0830fcd8eef411dad35f857361f48d43`; normal web/API health returned 200. No production release was run. |

## Boundaries that remain

- This is coordinator HA over one Redis primary/volume. Redis-primary loss is an
  outage; commands fail closed. It is not regional or storage failover.
- Existing membership may remain effective until admission expiry (at most ten
  minutes); immediate membership-revocation fan-out is not implemented.
- The MVP plays on each admitted, browser-unlocked device. Legacy one-speaker
  routing, full native/background/device acceptance and physical iPhone Safari
  remain future parity/acceptance work. Browser autoplay policy still applies.
- Local slow-reader and property tests do not establish large public concurrency,
  resource ceilings or a WAN p95 SLO. The timing table is one small live run.
- ALAC-in-m4a can fail Chromium decoding (#2427, following #1595). The successful
  radio handoff proves its tested source, not compatibility with every codec.
- Native protected audio retains its file-backed path; the range-streaming
  improvement and its measurements concern browsers.

The historical research proposed several possible mechanisms. The MVP uses
atomic Redis sequencing with snapshot recovery instead of ownership leases or
historical intent replay. Docket, generalized actors, cutover, SDK/MCP and broad
UI redesign remain outside this goal.
