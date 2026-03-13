# research: full device support

**date**: 2026-02-22
**question**: what would full device support look like — toggling playback between phone, computer, and bluetooth speaker — and how does it relate to the existing jam output device pattern?

## summary

the jam output device pattern (`output_client_id` identifying which browser tab plays audio, server-mediated transfer, auto-pause on disconnect) is already 80% of a general device switching system. the main gap is that jams scope device tracking to a multi-user room, while solo device switching needs a per-user device registry that works outside of jams. the cleanest path forward is extracting a shared `DeviceSession` concept that both jams and solo playback build on top of.

## the jam pattern today

jams already solve the hard problems:

1. **device identity**: per-tab UUID (`client_id`) in `sessionStorage` (`jam.svelte.ts:32-37`)
2. **output designation**: server tracks `output_client_id` / `output_did` in jam state (`jams.py:48-49`)
3. **transfer**: `set_output` command with server-side validation (`jams.py:369-385`)
4. **cleanup**: auto-pause when output device disconnects (`jams.py:485-511`)
5. **playback gating**: non-output clients stay silent, output device plays audio (`Player.svelte:452-455`)
6. **progress sync**: non-output clients interpolate from server state (`Player.svelte:555-573`)

what jams DON'T have that device support needs:

- **device registry outside of jams** — today, `client_id` only matters during an active jam
- **device metadata** — no name, type, or "last seen" for each device
- **persistent connections for solo playback** — queue sync is request/response + BroadcastChannel (`queue.svelte.ts:114`), not WebSocket
- **multi-device awareness for a single user** — `_ws_by_did` enforces one WS per DID (`jams.py:57`), which would need to change

## how spotify connect works (for context)

spotify connect is the closest industry analog:

- **server-mediated**: all transfers go through spotify's backend, not peer-to-peer
- **device registry**: devices maintain persistent connections and advertise via ZeroConf/mDNS for local discovery + server API for remote
- **single active device**: server enforces one output device per account
- **transfer = pointer update**: server updates active device pointer, pushes state to new device, old device receives pause event
- **device IDs are ephemeral**: must re-fetch list; IDs not guaranteed persistent across sessions
- **web playback SDK**: browser is a first-class device (WebSocket to server for receiving commands)

key difference from plyr.fm: spotify's devices are always-connected receivers that the server pushes commands to. plyr.fm's current architecture has the client pulling state (queue fetches) with BroadcastChannel for same-browser sync.

## proposed design

### core concept: DeviceSession

extract the device identity + output designation pattern from jams into a standalone concept that works for both solo and jam playback.

```
DeviceSession {
  client_id: string       // UUID per browser tab (already exists in jam)
  did: string             // account identity
  name: string            // "Chrome on MacBook", "Safari on iPhone"
  device_type: string     // "desktop" | "mobile" | "tablet"
  connected_at: datetime
  last_seen_at: datetime
  is_output: boolean      // this device plays audio
}
```

### architecture layers

```
┌─────────────────────────────────────────────────┐
│  DeviceService (new)                            │
│  - device registry (WebSocket connections)      │
│  - output designation (who plays audio)         │
│  - transfer command (move output to device X)   │
│  - heartbeat / disconnect detection             │
└──────────────────────┬──────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
┌─────────┴──────────┐  ┌──────────┴─────────┐
│  Solo playback     │  │  Jam playback      │
│  - personal queue  │  │  - shared queue    │
│  - device transfer │  │  - device transfer │
│  - cross-device    │  │  - multi-user      │
│    queue sync      │  │    + multi-device  │
└────────────────────┘  └────────────────────┘
```

### what changes

#### backend

**new: `DeviceService`** (or extend existing `QueueService`)
- maintains WebSocket connections per device (not just per DID)
- tracks `client_id → DeviceSession` with heartbeat
- handles `set_output` for solo playback (same command shape as jams)
- publishes device state changes via Redis Streams (same transport as jams)

**new: WebSocket endpoint for solo playback**
- `/devices/ws` — persistent connection for device registry + command receiving
- authenticated via session cookie (same as jam WS)
- sends `sync` with `client_id` on connect (same protocol as jam WS)
- receives state pushes when output transfers away

**refactor: `JamService._ws_client_ids` → shared device registry**
- currently `_ws_client_ids: dict[WebSocket, str]` lives on JamService (`jams.py:59`)
- extract to `DeviceService` so both solo and jam flows use same device tracking
- jam WS and device WS can share the same underlying mapping

**refactor: `_ws_by_did` one-WS-per-DID constraint**
- currently enforced in `connect_ws` (`jams.py:428`) — each DID gets one WebSocket
- for device support: one DID can have multiple WebSockets (phone + laptop)
- change to `_ws_by_did: dict[str, list[tuple[str, WebSocket]]]` or separate device-level tracking
- jam WS and device WS would be separate connections (different endpoints)

**no new database table needed initially**
- device sessions are ephemeral (WebSocket lifetime)
- output designation lives in queue state (add `output_client_id` to `QueueState.state` JSON, same as jam state)
- if persistent device naming is wanted later, that's a separate concern

#### frontend

**extend `jam.svelte.ts` → extract `device.svelte.ts`**
- `clientId` generation already works (`jam.svelte.ts:32-37`)
- `isOutputDevice` getter already works (`jam.svelte.ts:54-56`)
- extract into `device.svelte.ts` that both solo and jam flows import
- solo: WebSocket to `/devices/ws`, receives state pushes
- jam: WebSocket to `/jams/{code}/ws` (unchanged), but uses shared device identity

**`Player.svelte` effects — already output-aware**
- paused-state-sync already gates on `isOutputDevice` (`Player.svelte:452-455`)
- drift correction already output-only (`Player.svelte:540`)
- non-output progress sync already works (`Player.svelte:555-573`)
- these effects just need to check the device layer instead of (or in addition to) the jam layer

**`Queue.svelte` — device picker UI**
- during a jam: output picker is in the jam header (already exists)
- outside a jam: device picker in player footer or queue panel
- same "play here" button pattern

#### queue sync upgrade

today's solo queue sync is request/response:
1. tab pushes state to server via PUT `/queue/` (`queue.svelte.ts:337-430`)
2. server responds with revision
3. tab broadcasts revision to other same-browser tabs via BroadcastChannel (`queue.svelte.ts:417`)
4. other tabs refetch (`queue.svelte.ts:128`)

for cross-device (phone ↔ laptop), BroadcastChannel doesn't work. options:

**option A: WebSocket push (recommended)**
- the device WS connection doubles as queue state channel
- when queue state changes, server pushes to all connected devices for that DID
- same pattern as jam state broadcast, just scoped to one user
- replaces BroadcastChannel for cross-device sync (BroadcastChannel stays for same-browser)

**option B: SSE per device**
- lighter than WebSocket if we only need server → client
- but we already need client → server for commands, so WebSocket makes more sense

**option C: polling**
- simplest but worst UX — seconds of lag between devices. not worth it.

### what stays the same

- `client_id` generation in `sessionStorage` — already correct, per-tab identity
- `set_output` command shape — `{ type: 'set_output', client_id: '...' }`
- server-side validation — output can only be claimed by the sender's own client_id
- auto-pause on output disconnect — same `_clear_output_if_matches` logic
- `player.paused` synchronous setting for autoplay policy — stays in `queue.play()`
- `onplay`/`onpause` handler gating — needed whenever server owns playback state

### incremental path

this doesn't need to land all at once:

1. **phase 1: device identity (small)**
   - extract `client_id` from jam into shared `device.svelte.ts`
   - add device name/type detection (User-Agent parsing or `navigator.userAgentData`)
   - add `/devices/ws` endpoint with heartbeat + device list
   - add `GET /devices/` endpoint to list connected devices for current user

2. **phase 2: solo output device (medium)**
   - add `output_client_id` to `QueueState.state`
   - add `set_output` command via device WS
   - gate `Player.svelte` effects on device-level output (not just jam-level)
   - cross-device queue push via device WS

3. **phase 3: jam integration (small)**
   - refactor jam to use `DeviceService` for device tracking
   - remove duplicate `_ws_client_ids` from JamService
   - jam output transfer delegates to device layer

4. **phase 4: UI polish**
   - device picker in player footer
   - device names ("Nate's MacBook", "Nate's iPhone")
   - "listening on another device" banner
   - device transfer animation

### bluetooth speaker note

"bluetooth speaker" in the user's question is a red herring for the web app — the browser handles Bluetooth audio routing via OS-level output selection. plyr.fm doesn't need to know about Bluetooth speakers specifically. what the user really means is: "I'm on my laptop connected to a Bluetooth speaker, and I want to switch playback to my phone (which has its own speaker/headphones)." that's device transfer between browser tabs on different physical devices, which is exactly what this design covers.

## code references

- `frontend/src/lib/jam.svelte.ts:32-37` — clientId generation (reusable for device identity)
- `frontend/src/lib/jam.svelte.ts:54-56` — isOutputDevice getter (pattern for device layer)
- `frontend/src/lib/jam.svelte.ts:225-227` — setOutput command (same shape for solo)
- `backend/src/backend/_internal/jams.py:48-49` — output_client_id/output_did in state
- `backend/src/backend/_internal/jams.py:56-60` — _ws_client_ids mapping (extract to device service)
- `backend/src/backend/_internal/jams.py:369-385` — set_output command handler (generalize)
- `backend/src/backend/_internal/jams.py:485-511` — _clear_output_if_matches (reuse for solo)
- `backend/src/backend/_internal/jams.py:470-483` — _close_ws_for_did (needs multi-device refactor)
- `frontend/src/lib/components/player/Player.svelte:452-455` — output device gating (already correct)
- `frontend/src/lib/components/player/Player.svelte:555-573` — non-output progress sync (reusable)
- `frontend/src/lib/queue.svelte.ts:114-130` — BroadcastChannel cross-tab sync (stays, supplemented by WS)
- `backend/src/backend/_internal/queue.py:24-43` — QueueService with LISTEN/NOTIFY (extend or parallel)

## open questions

- **do we need device persistence?** ephemeral (WS lifetime) is simpler and matches spotify connect. persistent device names would need a table and a registration flow.
- **one WS or two during a jam?** if solo device WS is always connected, a user in a jam would have two WebSocket connections (device + jam). could unify into one connection with multiplexed channels, or keep them separate (simpler, at cost of one extra connection).
- **output on page load?** when a user opens plyr.fm on their laptop, should it auto-claim output? spotify does this ("web player" appears in device list). or should it stay silent until explicitly claimed? auto-claim is better UX for single-device users but annoying if you're already listening on your phone.
- **feature flag scope?** device switching could share the `jams` flag or get its own. separate flag allows independent rollout.
