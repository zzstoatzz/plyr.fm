# Spaces and real-time playback

**Date:** November 5, 2026
**Question:** How should smooth seeking and collaborative Jams use Spaces, Zig, and the existing WebSocket/Docket libraries?
**Status:** Research and proposed next slice, not an implemented or accepted architecture. No runtime changes.

## Recommendation

Keep each Jam anchored in its creator-owned Space. Use a separately supervised Zig room sequencer for live commands and playback timing, reusing the existing WebSocket implementation. Use a purpose-specific Redis state/event adapter for ordered recovery; Docket remains background execution. Keep canonical record writes out of the read-only appview, and keep audio bytes off the room command connection.

This is a proposal to evaluate, not a claim that adding WebSockets or choosing Zig establishes latency or scaling. The first deliverable should be measured playback/transport baselines and a deterministic room model, before another UI redesign.

## What the sources establish

The shared [Spaces note](/Users/nate/tangled.org/zzstoatzz.io/notes/atproto/spaces.md) explicitly distinguishes ephemeral coordination from records that should outlive a session. Its early `simplespace` wire shapes and one-bit access discussion are historical. Do not port those assumptions into current code.

[Proposal 0016 at 9e86df35](https://github.com/bluesky-social/proposals/blob/9e86df35b17f828294333a4c5b95dce22bcbf323/0016-permissioned-data/README.md) is still a proposal. The implementation branch was separately fetched at `e72a939e9ebe61d1d7a7e9e4d9618f926ead92ea`.

- A Space is an authorization/sync boundary across per-author repos, not one shared mutable database or a live command bus. The creator's authority DID, each author's repo, and an application's live sequencer are different roles.
- Read and write permissions are now separate. Write permission governs writer discovery/notification, not whether a user can physically write records into their own repo. Application semantics still decide which writers and records to accept. See [baseline policies](https://github.com/bluesky-social/proposals/blob/9e86df35b17f828294333a4c5b95dce22bcbf323/0016-permissioned-data/README.md#baseline-policies).
- `notifyWrite` is a change hint without record data. The host sequences notifications, delivers them with reasonable effort, and a syncer follows up with repo reads. Missed revisions recover through `listRepos(since)` and repo sync. That is useful replication machinery, not a bounded-latency interactive command contract. See [sync](https://github.com/bluesky-social/proposals/blob/9e86df35b17f828294333a4c5b95dce22bcbf323/0016-permissioned-data/README.md#sync).
- Current `space.putRecord` has no compare-and-swap argument. A JSON `revision` property does not fence two host tabs. The reference handler serializes its storage transaction but does not compare an application's expected revision. See [lexicon](https://github.com/bluesky-social/atproto/blob/e72a939e9ebe61d1d7a7e9e4d9618f926ead92ea/lexicons/com/atproto/space/putRecord.json) and [handler](https://github.com/bluesky-social/atproto/blob/e72a939e9ebe61d1d7a7e9e4d9618f926ead92ea/packages/pds/src/api/com/atproto/space/putRecord.ts).
- A delegation token is single-use and addressed to the Space authority; it is not interchangeable with service auth. A Space credential is key-bound, reusable until expiry, and does not itself identify the member to a separate room service. DID authentication and Space admission must be established separately in the join protocol. Never accept a client-supplied actor DID or a MAC as a transferable authorship proof.
- Credential expiry and optional revocation fan-out bound access. Membership changes do not imply every existing socket and credential is instantly revoked. Specify renewal, room-policy freshness, and disconnect behavior explicitly.

This is current upstream source, not the version deployed by every PDS or automatically the version compatible with Next's locked `@atproto/space` alpha packages. Wire changes require pinned-library and real-host acceptance checks; do not silently upgrade from this comparison.

## Current implementations differ

| Implementation | What it actually provides |
|---|---|
| Python production | Explicit play/pause commands; DB row-lock serialization; Redis Stream replay/fan-out; per-client speaker selection. Any active participant can seek. |
| Running Next room | Host-only Space writes, read-only invitees, one track, snapshot polling after each read plus one second, browser-clock timestamps. No participant command gateway. |
| `next/services/jams/room.mts` | Pure revision/permission reducer and two-PDS probe, not the authority driving the running room. No command IDs, writer fencing, occurrence epochs or speaker modes. |

Relevant code: [Python command handler](../../backend/src/backend/_internal/jams.py#L299), [production queue gateway](../../frontend/src/lib/queue.svelte.ts#L546), [Next room](../../next/app/app/jam/[room].tsx#L63), [Space client](../../next/app/src/jam-space.ts#L21), [foundation status](../../next/services/jams/README.md), and [reducer](../../next/services/jams/room.mts#L75).

Preserve production's single playback gateway: UI buttons express intent through one solo/Jam boundary. Currently Next's global `toggle`, `seek` and `skip` act locally even in a Jam; polling may undo that local action afterward. `syncJam` hard-seeks above 0.6 seconds on each poll, using a position calculated before potentially slow media loading. See [playback](../../next/app/src/playback.tsx#L189).

Preserve the history behind output modes, browser gesture/autoplay handling, reconnect limits and disconnect ordering. Production fixes include #959 (queue mutation), #960 (queue gateway), #962–#964 (output selection/fallback), #984 (remove closing sockets before fan-out), #1203/#1204 (transport limits), and #1759 (radio/Jam handoff). The [transport decision](../internal/architecture/jams-transport-decision.md) calls for broadcast streams, not consumer-group work distribution. Its trimmed-history recovery description is stronger than the current Python failure paths.

## Existing libraries and constraints

| Component | Inspected version | Consequence |
|---|---|---|
| Zat | v0.6.4 / `aebe50af` | Already carries the relevant WebSocket dependency transitively; plyr does not yet expose its server. |
| websocket.zig | v0.2.0 / `31c9cebf` | `runIo`, connection/message limits, timeouts, ping/pong and shutdown machinery are reusable. Callback serialization is per connection, not per room. |
| Redis | plyr pin `89b1157e` | One connection, no pipelining; borrowed responses expire on the next command. Separate blocking readers from command writers. |
| Docket | published v0.0.5 / `ea9790a8` | Zig 0.17-compatible candidate to audit/pin, not currently a plyr dependency. Do not confuse the local checkout's stale 0.0.4 version field with the published 0.0.4 tag, which targets Zig 0.16. |

Critical details:

- [Current API server](../../next/backend/src/server.zig#L10) spawns one OS thread per accepted connection under a semaphore. Do not extend that model to large numbers of long-lived Jam sockets and assume language choice fixes scaling.
- WebSocket `Conn.write` is synchronized but can block its writer. Never hold room serialization while writing sequentially to sockets. Add bounded per-peer outboxes, write deadlines, independent fan-out and slow-reader handling.
- The pinned Redis `XREAD` helper accepts `COUNT` but `parseStreamReadResult` returns only `entries[0]`. Batched replay requires a parser fix or a deliberately different API, not assuming the rest of the batch was consumed. Copy response data into owned room/event memory before another command reuses its buffer.
- Docket's worker lifecycle is for durable, retryable jobs. It is not the play/pause/seek transport. Python `plyr` and Zig `plyr-zig` must remain separate namespaces and must not consume one another's task messages.
- The [background-work document](../internal/architecture/zig-background-work.md) has the right boundary, but its old unpublished-auth-fix discussion needs revalidation against a deliberately selected release. Published v0.0.5 includes schedule-idempotency fixes absent from the clean local checkout inspected first. Publication does not establish integration readiness.

Library source: [WebSocket server](https://tangled.org/zzstoatzz.io/websocket.zig/blob/31c9cebf86574f6693159548214bc8139975c9e0/src/server/server.zig), [Redis streams](https://tangled.org/zzstoatzz.io/redis/blob/89b1157e19d43b0b17ad58359afdce93247ca077/src/commands/streams.zig), [Docket v0.0.5](https://tangled.org/zzstoatzz.io/docket/tree/v0.0.5), and [plyr pins](../../next/backend/build.zig.zon).

## Proposed state placement

| State | Proposed owner/storage |
|---|---|
| Jam identity, creator, durable configuration and membership | Creator-owned Space/PDS; identify the accepted record author explicitly. |
| Live timeline, queue/occurrence identity, output client and room revision | One serialized Zig room sequencer; Redis-backed state and bounded event history. |
| Recent command results and coordinator ownership/fencing | Same room-store adapter, with bounded retention. |
| Socket presence, ping samples and latest scrub preview | Ephemeral bounded coordinator/client memory. |
| Recovery, reconciliation, optional media preparation | Docket jobs with stable IDs, outside the interactive command path. |
| Catalog projections | Existing read-only appview; no per-tick SQL writes. |
| Audio bytes | Existing content delivery path; public and protected access remain distinct. |

Redis state transition, revision check, command deduplication and event append must commit atomically. Do not recreate production's DB-commit-then-best-effort-XADD gap. An in-memory room owner may calculate the transition, but its durable commit must check its fencing epoch and expected revision. On storage failure, do not acknowledge a command as accepted.

The live sequencer does not become the Space authority. Keep user OAuth sessions on the client. Any future service-written checkpoint must use an explicitly admitted service DID's own repo, not impersonate the creator. Alternatively keep checkpoints client-written and make recovery semantics explicit. Do not silently turn optional checkpointing into a dependency of every command.

## Command and playback rules to specify first

- Provisional product policy: participants may play/pause; host controls seek. Host-only seek is a deliberate change from Python, not historical parity. Preserve collaborative queue editing; define destructive replacement and conflict rules explicitly rather than silently making all queue actions host-only. Room roles are application semantics, not inferred from generic Space write access.
- Commands name desired state (`play`/`pause`), a unique command ID, expected room revision, current track occurrence and room epoch. Authenticate the sender; derive actor identity server-side.
- Duplicate pause while already paused is an acknowledged no-op. A stale pause arriving after a newer play is rejected, not blindly retried against fresh state. A track occurrence prevents commands for an earlier appearance of the same URI from affecting a later one.
- Scrub preview follows the user's finger locally. Only eligible users commit a seek. Coalesce superseded pending seeks and define rapid input ordering explicitly; do not write a record for every pointer movement.
- Use a monotonic clock for live elapsed playback, offset estimates from measured round trips, and a new/re-anchored epoch after authority restart. Recompute the desired playhead after media preparation finishes; never apply a target made stale by loading.
- Distinguish a deliberate seek from drift. Let audio free-run between meaningful events; use measured deadbands/hysteresis rather than repeated corrective hard-seeks. Preserve gesture-dependent browser playback and per-client output identity (`one_speaker` versus `everyone`).
- Admission and credential renewal do cryptographic/PDS work; per-frame playhead updates do not. Cache verified material only within its validity bounds and prepare media by immutable identity, not once per listener or seek.
- Reconnect replays bounded authoritative events or replaces them with a fresh snapshot when history is trimmed. Never replay stale raw user intents as new actions.
- A Jam grant does not grant access to an artist's protected audio Space. Do not relay one participant's credentials to the others or place private bytes in a public cache.

## First implementation cycle

1. Instrument the existing player: pointer-to-thumb latency, seek-to-audible latency, bytes fetched, buffered ranges, source replacements, dropped frames and correction count. Public audio already has Range support in [the R2 service](../../next/services/audio/src/index.js#L48). Protected browser audio currently materializes the whole response as a Blob before playing ([code](../../next/app/src/gated-audio.web.ts#L6)); treat it as a separate delivery problem.
2. Port the command model into a pure Zig reducer with deterministic clock/network simulation. Exercise duplicated/reordered commands, two host tabs, lease loss, same-track occurrences, trim/reconnect, revocation and slow output devices. Reuse hegel rather than relying on a few happy-path browser runs.
3. Prove a small WebSocket/Redis vertical slice using the actual pinned libraries, separate from the read-only appview process. Measure command-to-peer latency, fan-out time, memory per socket/room, slow-reader isolation and restart recovery. Audit/fix Redis batching before claiming replay support. No Docket integration is required to establish this hot path.
4. Drive two independent browsers against real Spaces and real audio, including poor networks, backgrounding and rapid scrubbing. Keep the UI changes limited to immediate scrub feedback, coherent permissions and isolated playback-clock rendering. Choose latency/resource budgets from the baseline and report distributions, not one fast run.

Outstanding design proofs: the exact DID-plus-Space join handshake without server-held user OAuth; admission/role freshness and revocation budget; writer fencing and recovery semantics; protected seekable delivery; and the measured behavior of the chosen WebSocket runtime on Fly. None has been established by this document alone.
