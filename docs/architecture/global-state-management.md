# global state management

## overview

plyr.fm uses global state managers following the Svelte 5 runes pattern for cross-component reactive state.

## managers

### player (`frontend/src/lib/player.svelte.ts`)
- manages audio playback state globally
- tracks: current track, play/pause, volume, progress
- persists across navigation
- integrates with queue for track advancement

### uploader (`frontend/src/lib/uploader.svelte.ts`)
- manages file uploads in background
- fire-and-forget pattern - returns immediately
- shows toast notifications for progress/completion
- triggers cache refresh on success
- server-sent events for real-time progress

### tracks cache (`frontend/src/lib/tracks.svelte.ts`)
- caches track list globally
- 30-second cache window to reduce API calls
- provides instant navigation by serving cached data
- invalidates on new uploads
- includes like status for each track

### queue (`frontend/src/lib/queue.svelte.ts`)
- manages playback queue with server sync
- optimistic updates with 250ms debounce
- handles shuffle and repeat modes
- conflict resolution for multi-device scenarios
- see [`docs/queue-design.md`](../queue-design.md) for details

### liked tracks cache (`frontend/src/lib/tracks.svelte.ts`)
- caches user's liked tracks
- updated optimistically on like/unlike
- batch queries for efficient loading
- integrates with track list displays

### preferences (`frontend/src/lib/preferences.svelte.ts`)
- user preferences state
- accent color customization
- auto-play next track setting
- persisted to backend via `/preferences/` API
- localStorage fallback for offline access

### toast (`frontend/src/lib/toast.svelte.ts`)
- global notification system
- types: success, error, info, warning
- auto-dismiss with configurable duration
- in-place updates for progress changes

## pattern

```typescript
class GlobalState {
	// reactive state using $state rune
	data = $state<Type>(initialValue);

	// methods that mutate state
	updateData(newValue: Type) {
		this.data = newValue;
	}
}

export const globalState = new GlobalState();
```

## benefits

- survives navigation (state persists across route changes)
- single source of truth
- reactive updates automatically propagate to components
- no prop drilling

## flow examples

### upload flow

1. user clicks upload on portal page
2. `uploader.upload()` called - returns immediately
3. user navigates to homepage
4. homepage renders cached tracks instantly (no blocking)
5. upload completes in background
6. success toast appears
7. cache refreshes, homepage updates with new track

this avoids HTTP/1.1 connection pooling issues by using cached data instead of blocking on fresh fetches during long-running uploads.

### like flow

1. user clicks like button on track
2. UI updates immediately (optimistic)
3. `POST /tracks/{id}/like` sent in background
4. ATProto record created on user's PDS
5. database updated
6. if error occurs:
   - UI reverts to previous state
   - error toast shown
   - user can retry

### queue flow

1. user clicks "play now" on a track
2. queue state updates locally (instant feedback)
3. debounced PUT to `/queue/` (250ms)
4. server hydrates and returns full queue
5. client merges server state
6. other devices receive updates via periodic polling

### preferences flow

1. user changes accent color in settings
2. UI updates immediately
3. `PATCH /preferences/` sent in background
4. server updates and returns new preferences
5. changes persist across sessions
6. localStorage provides offline access

## state persistence

### server-side persistence

- **queue**: stored in `queue_state` table, synced via LISTEN/NOTIFY
- **liked tracks**: stored in `track_likes` table
- **preferences**: stored in `user_preferences` table

### client-side persistence

- **player volume**: localStorage (`playerVolume`)
- **queue position**: synced with server, cached locally
- **preferences**: server-authoritative, localStorage fallback

## benefits

- **cross-device sync**: queue and likes work across devices
- **offline resilience**: localStorage provides graceful degradation
- **instant feedback**: optimistic updates keep UI responsive
- **server authority**: conflicts resolved by server state
- **efficient updates**: debouncing and batching reduce API calls
