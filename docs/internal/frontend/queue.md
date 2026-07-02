---
title: "queue design"
---

## overview

The queue is a cross-device, server-authoritative data model with optimistic local updates. Every device performs queue mutations locally, pushes a full snapshot to the API, and receives hydrated track metadata back. Servers keep an in-memory cache (per process) in sync via Postgres LISTEN/NOTIFY so horizontally scaled instances observe the latest queue state without adding Redis or similar infra.

## server implementation

- `queue_state` table (`did`, `state`, `revision`, `updated_at`). `state` is JSONB containing `track_ids`, `current_index`, `current_track_id`, `shuffle`, `repeat_mode`, `original_order_ids`, and the continuation-tail fields (`continuation_from_index`, `continuation_suppressed`, `continuation_label`). The server persists `state` opaquely, so new tail fields need no schema or endpoint change.
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

- sidebar shows "now playing" card with prev/next buttons
- shuffle control in player footer (always visible)
- "up next" lists tracks beyond `currentIndex`
- drag-and-drop reordering supported for upcoming tracks
- removing a track updates local state and syncs to server
- `queue.playNow(track)` plays a single track: it becomes position 0, existing explicit up-next is preserved, and the continuation tail is dropped (a new context)
- `queue.playContext(tracks, startIndex, label)` plays a track tapped inside an ordered collection and queues the collection remainder as a labeled tail (see "playback contexts" below)
- duplicate tracks allowed - same track can appear multiple times in queue
- auto-play preference controls automatic advancement to next track
- persisted via `/preferences/` API and localStorage
- queue toggle button opens/closes sidebar
- responsive positioning for mobile viewports
- cannot remove currently playing track (index 0)

## playback contexts (the continuation tail)

- the queue is split by `continuationFromIndex` into two regions: the **explicit region** `[0, continuationFromIndex)` (the user's own picks) and a single **continuation tail** `[continuationFromIndex, length)` — a replaceable, auto-generated suffix rendered as "next from: \<label\>".
- the tail carries a source `continuationLabel`: `null` means the For You feed (the fallback backfill via `fillContinuation`); a collection name is set by `playContext` when a track is tapped inside an album/playlist.
- collection continuity is gated by the `play_through_collections` preference (default on) in one place — `collection-playback.ts`'s `playCollectionFrom` — so every ordered surface that routes through it inherits the opt-out with no new setting. opted out, a row tap falls back to single-track `playNow`. this is distinct from `keep_playing` (default off), which governs only the For You backfill.
- a context switch (`playNow`, `playContext`, `setQueue`) preserves the explicit region and drops the previous tail — hand-queued picks survive, stale recommendations do not.
- when a collection tail nears empty and "keep playing" is on, `fillContinuation` tops it up from For You and relabels the tail to `null`. only one tail exists at a time, so a mixed collection→feed tail shows a single label (the last 1–2 collection tracks can briefly read as "for you").
- radio is a separate source on the player (`player.radio`), not a queue context; entering the queue via any of these methods exits radio mode.

## shuffle

- shuffle is an action, not a toggle mode
- each shuffle operation randomly reorders upcoming tracks (after current track)
- preserves everything before and including the current track
- uses fisher-yates algorithm with retry logic to ensure different permutation
- original order preserved in `original_order_ids` for server persistence

## cross-tab synchronization

- uses BroadcastChannel API for same-browser tab sync
- each tab has unique `tabId` stored in sessionStorage
- queue updates broadcast to other tabs via `queue-updated` message
- tabs ignore their own broadcasts and duplicate revisions
- receiving tabs fetch latest state from server
- `lastUpdateWasLocal` flag tracks update origin

## future work

- realtime push via SSE/WebSocket for instant cross-device updates
- UI affordances for "queue updated on another device" notifications
- repeat modes (currently not implemented)
- clear up-next functionality exposed in UI
