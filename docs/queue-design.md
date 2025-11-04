# queue design

## overview

The queue is a cross-device, server-authoritative data model with optimistic local updates. Every device performs queue mutations locally, pushes a full snapshot to the API, and receives hydrated track metadata back. Servers keep an in-memory cache (per process) in sync via Postgres LISTEN/NOTIFY so horizontally scaled instances observe the latest queue state without adding Redis or similar infra.

## server implementation

- `queue_state` table (`did`, `state`, `revision`, `updated_at`). `state` is JSONB containing `track_ids`, `current_index`, `current_track_id`, `shuffle`, `repeat_mode`, `original_order_ids`.
- `QueueService` keeps a TTL LRU cache (`maxsize 100`, `ttl 5m`). Cache entries include both the raw state and the hydrated track list.
- On startup the service opens an asyncpg connection, registers a `queue_changes` listener, and reconnects on failure. Notifications simply invalidate the cache entry; consumers fetch on demand.
- `GET /queue/` returns `{ state, revision, tracks }`. `tracks` is hydrated server-side by joining against `tracks`+`artists`. Duplicate queue entries are preserved—hydration walks the `track_ids` array by index so the same `file_id` can appear multiple times. Response includes an ETag (`"revision"`).
- `PUT /queue/` expects an optional `If-Match: "revision"`. Mismatched revisions return 409. Successful writes increment the revision, emit LISTEN/NOTIFY, and rehydrate so the response mirrors GET semantics.
- Hydration preserves order even when duplicates exist by pairing each `track_id` position with the track returned by the DB. We never de-duplicate on the server.

## client implementation (Svelte 5)

- Global queue store (`frontend/src/lib/queue.svelte.ts`) uses runes-backed `$state` fields for `tracks`, `currentIndex`, `shuffle`, etc. Methods mutate these states synchronously so the UI remains responsive.
- A 250 ms debounce batches PUTs. We skip background GETs while a PUT is pending/in-flight to avoid stomping optimistic state.
- Conflict handling: on 409 the client performs a forced `fetchQueue(true)` which ignores local ETag and applies the server snapshot if the revision is newer. Older revisions received out-of-order are ignored.
- Before unload / visibility change flushes pending work to reduce data loss when navigating away.
- Helper getters (`getCurrentTrack`, `getUpNextEntries`) supplement state but UI components bind directly to `$state` so Svelte reactivity tracks mutations correctly.
- Duplicates: adding the same track repeatedly simply appends another copy. Removal is disabled for the currently playing entry (conceptually index 0); the queue sidebar only allows removing future items.

## UI behavior

- Sidebar layout shows a dedicated "Now Playing" card with prev/next buttons. Shuffle/repeat controls now live in the global player footer so they're always visible.
- "Up Next" lists tracks strictly beyond `currentIndex`. Drag-and-drop reorders upcoming entries; removing an item updates both local state and server snapshot.
- Clicking "play" on any track list item (e.g., latest tracks) invokes `queue.playNow(track)`: the new track is inserted at the head of the queue and becomes now playing without disturbing the existing "up next" order. Duplicate tracks are allowed—each click adds another instance to the queue.
- User preference "Auto-play next track" controls whether we automatically advance when the current track ends (`queue.autoAdvance`). Toggle lives in the settings menu (gear icon in header) alongside accent color picker and persists via `/preferences/`. When enabled, playback automatically starts the next track after the `loadeddata` event fires. When disabled, playback stops after the current track ends.
- The clear ("X") control was removed—clearing the queue while something is playing is not supported. Instead users remove upcoming tracks individually or replace the queue entirely.
- Queue toggle button (three horizontal lines icon) opens/closes the sidebar. On mobile (≤768px), the button is positioned higher (200px from bottom) to remain visible above the taller stacked player controls. The sidebar takes full screen width on mobile.

## repeat & shuffle

- Repeat modes (`none`, `all`, `one`) are persisted server-side and applied client-side when advancing tracks.
- Shuffle saves the pre-shuffled order in `original_order_ids` so we can toggle back. Shuffling maintains the currently playing track by re-positioning it within the shuffled array.

## open questions / future work

- Realtime push: with hydrated responses in place we can broadcast queue changes over SSE/WebSocket so secondary devices update instantly.
- Cache sizing: TTLCache defaults are conservative; monitor production usage to decide whether to expose knobs.
- Multi-device conflict UX: today conflicts simply cause the losing client to refetch and replay UI changes. We may want UI affordances for “queue updated on another device”.
