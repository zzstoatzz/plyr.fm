# jams — shared listening rooms

real-time shared playback rooms. server-side only (no ATProto records in v1). gated behind `jams` feature flag.

## overview

jams let multiple users listen to the same music in sync. one user creates a jam, gets a shareable link, and anyone with the link (and the feature flag) can join. all participants can control playback — it's democratic and chaotic by design. no host-only lock. no chat.

a jam is "your queue, but shared." the queue panel becomes the jam UI. there's no separate jam page or jam player — the existing player footer handles everything.

## playback model

each client plays audio independently on its own device. the server owns the authoritative state (what track, what position, playing or paused), and clients sync to it.

**sync is command-driven, not continuous.** the server broadcasts state only when someone does something — play, pause, seek, skip, add a track. between commands, each client free-runs its own audio element. clients may drift apart during uninterrupted playback and that's intentional. the next command re-syncs everyone.

position interpolation: server stores a snapshot `{progress_ms, server_time_ms, is_playing}` on each state transition. clients compute current position as:

```
if playing:  progress_ms + (Date.now() - server_time_ms)
if paused:   progress_ms
```

drift correction: if a client's audio element is >2 seconds off from the interpolated server position, it seeks. this only fires when new state arrives via WebSocket, not every frame.

## data model

### tables

**`jams`**: room state. `code` is an 8-char alphanumeric for URLs (`plyr.fm/jam/a1b2c3d4`). `state` is a JSONB playback snapshot. `revision` is monotonic — incremented on every mutation. `host_did` is display-only (any participant controls playback).

**`jam_participants`**: join/leave tracking. `left_at IS NULL` means currently active. partial index `ix_jam_participants_did_active` makes "find user's active jam" fast.

### playback state shape (JSONB)

```json
{
  "track_ids": ["abc", "def"],
  "current_index": 0,
  "current_track_id": "abc",
  "is_playing": true,
  "progress_ms": 12500,
  "server_time_ms": 1708000000000
}
```

## transport

Redis Streams. see `jams-transport-decision.md` for rationale.

each jam has a stream `jam:{id}:events` (MAXLEN ~1000). backend instances run `XREAD BLOCK` per active jam and fan out to connected WebSockets. no consumer groups — each instance reads independently.

## commands

all 9 commands are server-authoritative. clients send requests via WebSocket, server applies them, increments revision, broadcasts result.

| command | behavior |
|---------|----------|
| `play` | set `is_playing = true`, update `server_time_ms` |
| `pause` | freeze `progress_ms` at interpolated position, set `is_playing = false` |
| `seek` | set `progress_ms` to requested position |
| `next` | advance `current_index` if not at end |
| `previous` | go back `current_index` if not at start |
| `add_tracks` | append track IDs to queue, auto-init if queue was empty |
| `play_track` | insert track after current, jump to it, auto-play |
| `set_index` | jump to specific track index |
| `remove_track` | remove track, adjust `current_index` if needed |

## WebSocket protocol

client → server:
- `{type: "sync", last_id: string | null}` — initial sync / reconnect
- `{type: "command", payload: {type: "play" | "pause" | "seek" | ..., ...}}` — playback commands
- `{type: "ping"}` — heartbeat

server → client:
- `{type: "state", stream_id, revision, state, tracks?, tracks_changed?, actor}` — snapshot
- `{type: "participant", event: "joined" | "left", ...}` — presence
- `{type: "pong"}` — heartbeat response
- `{type: "error", message}` — errors

reconnect: client sends `{type: "sync", last_id: "..."}` with its last stream ID. server replays missed events via `XRANGE`. if stream was trimmed, falls back to full DB snapshot.

## API

| method | route | description |
|--------|-------|-------------|
| POST | `/jams/` | create jam (accepts initial playback state) |
| GET | `/jams/active` | user's current active jam |
| GET | `/jams/{code}` | get jam details |
| POST | `/jams/{code}/join` | join |
| POST | `/jams/{code}/leave` | leave |
| POST | `/jams/{code}/end` | end (host only) |
| POST | `/jams/{code}/command` | playback command (REST fallback) |
| WS | `/jams/{code}/ws` | real-time sync (cookie auth) |

create accepts `current_index`, `is_playing`, `progress_ms` so starting a jam preserves the host's current playback state.

## frontend architecture

### bridge pattern

the queue is the single integration point for all playback mutations. no `if (jam.active)` conditionals in UI components.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  playback.ts │────>│    queue      │────>│  jam (WS)    │
│  controls    │     │  .playNow()  │     │  .playTrack()│
│  Queue.svelte│     │  .next()     │     │  .next()     │
│  feed clicks │     │  .addTracks()│     │  .addTracks()│
└──────────────┘     └──────────────┘     └──────────────┘
    callers            single gate          transport
    (unchanged)        (jam-aware)          (registered)
```

`jam.svelte.ts` registers a `JamBridge` with the queue on create/join, unregisters on leave/destroy. queue methods check the bridge first — if set, route through WebSocket; if not, do normal local mutation.

see `jams-queue-integration.md` for design rationale.

### bridged queue methods

these route through the jam when a bridge is set:

`playNow`, `addTracks`, `goTo`, `next`, `previous`, `removeTrack`, `play`, `pause`, `seek`, `togglePlayPause`

### NOT bridged (local-only, broken during jams)

`moveTrack` (reorder), `toggleShuffle`, `clearUpNext`, `setQueue`, `clear`

these operate on local queue state only. using them during a jam will desync.

### Player.svelte effects

Player.svelte still imports `jam` directly for incoming state sync. four jam-related effects:

1. **track sync** — when `jam.active && jam.currentTrack`, drives player track loading from jam state instead of queue
2. **pause sync** — watches `jam.isPlaying`, sets `player.paused` accordingly. uses `untrack()` to avoid running every frame
3. **drift correction** — watches `jam.interpolatedProgressMs`, seeks if audio element is >2s off. uses `untrack()`
4. **position save skip** — when `jam.active`, skips saving playback position to server (jam owns it)

### join flow

1. user visits `/jam/[code]`
2. `onMount` calls `jam.join(code)` — POST to backend, sets up WebSocket, registers bridge
3. `goto('/')` (SvelteKit navigation, preserves runtime state)
4. `$effect` in layout detects `jam.active`, auto-opens queue panel

### reconnect on page load

layout `onMount` (after auth init) calls `jam.fetchActive()`. if the user has an active jam, calls `jam.join(code)` to reconnect WebSocket and re-register bridge.

### jam UI

when a jam is active, the queue panel shows:
- jam name and 6-char share code
- connection status dot (green = connected, yellow = reconnecting)
- participant avatars
- copy-link button
- leave button
- rainbow gradient border on the queue panel

## edge cases

- **personal queue**: preserved in Postgres, untouched during jam. restored on leave
- **host leaves**: jam continues. any participant controls playback. jam ends when all leave or host calls `/end`
- **all leave**: jam marked inactive, Redis stream deleted
- **auto-leave**: creating or joining a new jam auto-leaves any previous jam
- **reconnect**: exponential backoff (1s → 30s), sync from last stream ID, drift correction
- **page refresh**: layout detects active jam via `GET /jams/active` and reconnects
- **simultaneous commands**: server-authoritative, serialized via revision. no row locking (see known issues)
- **gated tracks**: each client resolves audio independently. non-supporters get toast + skip

## known issues and follow-ups

### high priority

- **no row locking on concurrent commands** — two participants sending commands simultaneously can race. server applies both without conflict detection. revision increments are not atomic with state reads.
- **track metadata desync** — server events for `tracks_changed` include track objects, but these may be stale or missing if hydration fails. clients should handle missing track metadata gracefully.

### medium priority

- **unbridged queue methods** — `moveTrack`, `toggleShuffle`, `clearUpNext` operate locally during jams, causing desync. need bridge methods or should be disabled during jams.
- **WS endpoint doesn't check membership** — WebSocket accepts any authenticated user, not just jam participants. membership is only checked inside `handle_command`.
- **`_auto_leave` cleanup** — leaves previous jams but doesn't close the old WebSocket or unregister the old bridge on the client side.
- **no WebSocket tests** — 21 backend tests cover REST endpoints and command logic, but no tests for WebSocket connection, sync, or reconnection.

### nice to have

- **periodic sync heartbeat** — server could broadcast position every N seconds during playback to reduce drift between commands. not needed unless drift becomes noticeable in practice.
- **queue reorder via drag** — needs a bridge method and backend command to support reordering during jams.

## files

| file | role |
|------|------|
| `backend/src/backend/models/jam.py` | Jam, JamParticipant SQLAlchemy models |
| `backend/src/backend/_internal/jams.py` | JamService — commands, state management, Redis Streams |
| `backend/src/backend/api/jams.py` | REST + WS endpoints, request/response models |
| `backend/tests/api/test_jams.py` | 21 tests covering CRUD, commands, lifecycle |
| `frontend/src/lib/jam.svelte.ts` | JamState singleton — WebSocket, bridge registration |
| `frontend/src/lib/queue.svelte.ts` | JamBridge interface, bridge routing in queue methods |
| `frontend/src/lib/components/Queue.svelte` | Jam UI (participants, share, leave, rainbow border) |
| `frontend/src/lib/components/player/Player.svelte` | Jam sync effects (track, pause, drift correction) |
| `frontend/src/lib/playback.svelte.ts` | No jam awareness — routes through queue (bridge handles it) |
| `frontend/src/lib/components/player/PlaybackControls.svelte` | No jam awareness — calls queue methods |
| `frontend/src/routes/jam/[code]/+page.svelte` | Join page — calls jam.join(), goto('/') |
| `frontend/src/routes/+layout.svelte` | Startup reconnect via fetchActive(), auto-open queue |
| `docs/architecture/jams-queue-integration.md` | Bridge pattern design rationale |
| `docs/architecture/jams-transport-decision.md` | Redis Streams decision record |
| `backend/alembic/versions/2026_02_19_*_add_jams_tables.py` | Migration |
