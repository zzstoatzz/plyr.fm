# jams — shared listening rooms

real-time shared playback rooms. server-side only (no ATProto records in v1). gated behind `jams` feature flag.

## overview

jams let multiple users listen to the same music in sync. one user creates a jam, gets a shareable link, and anyone with the link (and the feature flag) can join. all participants can control playback — there's no host-only lock. no chat.

## data model

### tables

**`jams`**: room state. `code` is an 8-char alphanumeric for URLs (`plyr.fm/jam/a1b2c3d4`). `state` is a JSONB playback snapshot (track list, current index, play/pause, progress). `revision` is monotonic — incremented on every mutation. `host_did` is display-only (any participant controls playback).

**`jam_participants`**: join/leave tracking. `left_at IS NULL` means currently active. partial index `ix_jam_participants_did_active` makes "find user's active jam" fast.

### playback state shape

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

## playback sync

server-timestamp + client interpolation. server stores `{progress_ms, server_time_ms, is_playing}` on state transitions only. each client computes:

```
current_position = progress_ms + (Date.now() - server_time_ms)
```

drift correction: if `|player.currentTime - interpolated| > 2s`, seek. no continuous position streaming.

## WebSocket protocol

client → server:
- `{type: "sync", last_id: string | null}` — initial sync / reconnect
- `{type: "command", payload: {type: "play" | "pause" | "seek" | "next" | "previous" | "add_tracks" | "remove_track", ...}}` — playback commands
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
| POST | `/jams/` | create jam |
| GET | `/jams/active` | user's current jam |
| GET | `/jams/{code}` | get jam details |
| POST | `/jams/{code}/join` | join |
| POST | `/jams/{code}/leave` | leave |
| POST | `/jams/{code}/end` | end (host only) |
| POST | `/jams/{code}/command` | playback command |
| WS | `/jams/{code}/ws` | real-time sync (cookie auth) |

## frontend

`JamState` class in `lib/jam.svelte.ts` — singleton with Svelte 5 runes. manages WebSocket lifecycle with exponential backoff reconnect (1s → 30s). commands sent via WebSocket, not REST.

Player.svelte has jam-aware effects: when `jam.active`, track sync comes from jam state instead of personal queue. drift correction seeks if >2s off. PlaybackControls routes play/pause/seek/next/prev through jam when active.

jam page at `/jam/[code]` — shows current track, playback controls, participant avatars, share button. on mount: joins jam, pauses personal queue saving. on destroy: leaves jam, restores personal queue.

## edge cases

- **personal queue**: preserved in Postgres, untouched during jam. restored on leave
- **host leaves**: jam continues. any participant controls playback. jam ends when all leave or host calls `/end`
- **all leave**: jam marked inactive, Redis stream deleted
- **reconnect**: exponential backoff, sync from last stream ID, drift correction
- **simultaneous commands**: server-authoritative, serialized via revision. clients converge within ~200ms
- **gated tracks**: each client resolves audio independently. non-supporters get toast + skip

## files

- `backend/src/backend/models/jam.py` — Jam, JamParticipant models
- `backend/src/backend/_internal/jams.py` — JamService
- `backend/src/backend/api/jams.py` — REST + WS endpoints
- `frontend/src/lib/jam.svelte.ts` — JamState
- `frontend/src/routes/jam/[code]/` — jam page
- `backend/tests/api/test_jams.py` — 19 endpoint tests
