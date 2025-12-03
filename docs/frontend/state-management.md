# state management

## svelte 5 runes mode

plyr.fm uses svelte 5 runes mode throughout the frontend. **all reactive state must use the `$state()` rune**.

### component-local state

**critical**: in svelte 5 runes mode, plain `let` variables are NOT reactive. you must explicitly opt into reactivity.

```typescript
// ❌ WRONG - no reactivity, UI won't update
let loading = true;
let tracks = [];
let selectedId = null;

// assignments won't trigger UI updates
loading = false; // template still shows "loading..."
tracks = newTracks; // template won't re-render
```

```typescript
// ✅ CORRECT - reactive state
let loading = $state(true);
let tracks = $state<Track[]>([]);
let selectedId = $state<number | null>(null);

// assignments trigger UI updates
loading = false; // template updates immediately
tracks = newTracks; // template re-renders with new data
```

### when to use `$state()`

use `$state()` for any variable that:
- is used in the template (`{#if loading}`, `{#each tracks}`, etc.)
- needs to trigger UI updates when changed
- is bound to form inputs (`bind:value={title}`)
- is checked in reactive blocks (`$effect(() => { ... })`)

use plain `let` for:
- constants that never change
- variables only used in functions/callbacks (not template)
- intermediate calculations that don't need reactivity

### common mistakes

**1. mixing reactive and non-reactive state**

```typescript
// ❌ creates confusing bugs - some state updates, some doesn't
let loading = true;                    // non-reactive
let tracks = $state<Track[]>([]);      // reactive
let selectedId = $state<number | null>(null); // reactive
```

**2. forgetting `$state()` after copy-pasting**

```typescript
// ❌ copied from svelte 4 code
let editing = false;
let editValue = '';

// ✅ updated for svelte 5
let editing = $state(false);
let editValue = $state('');
```

**3. assuming reactivity from svelte 4 habits**

svelte 4 made all component `let` variables reactive by default. svelte 5 requires explicit `$state()` opt-in for finer control and better performance.

### debugging reactivity issues

**symptom**: template shows stale data even though console.log shows variable updated

```typescript
async function loadData() {
    loading = true; // variable updates...
    const data = await fetch(...);
    loading = false; // variable updates...
    console.log('loading:', loading); // logs "false"
}
// but UI still shows "loading..." spinner
```

**diagnosis**: missing `$state()` wrapper

```typescript
// check variable declaration
let loading = true; // ❌ missing $state()

// fix
let loading = $state(true); // ✅ now reactive
```

**verification**: after adding `$state()`, check:
1. variable assignments trigger template updates
2. no console errors about "Cannot access X before initialization"
3. UI reflects current variable value

## global state management

### overview

plyr.fm uses global state managers following the Svelte 5 runes pattern for cross-component reactive state.

## managers

### player (`frontend/src/lib/player.svelte.ts`)
- manages audio playback state globally
- tracks: current track, play/pause, volume, progress
- persists across navigation
- integrates with queue for track advancement
- media session integration in `Player.svelte` (see below)

### uploader (`frontend/src/lib/uploader.svelte.ts`)
- manages file uploads in background
- fire-and-forget pattern - returns immediately
- shows toast notifications for progress/completion
- triggers cache refresh on success
- server-sent events for real-time progress

### tracks cache (`frontend/src/lib/tracks.svelte.ts`)
- caches track list globally in localStorage
- provides instant navigation by serving cached data
- invalidates on new uploads
- includes like status for each track (when authenticated)
- simple invalidation model - no time-based expiry

### queue (`frontend/src/lib/queue.svelte.ts`)
- manages playback queue with server sync
- optimistic updates with 250ms debounce
- handles shuffle and repeat modes
- conflict resolution for multi-device scenarios
- see [`queue.md`](./queue.md) for details

### liked tracks (`frontend/src/lib/tracks.svelte.ts`)
- like/unlike functions exported from tracks module
- invalidates cache on like/unlike
- fetch liked tracks via `/tracks/liked` endpoint
- integrates with main tracks cache for like status

### preferences
- user preferences managed through `ProfileMenu.svelte` (mobile) and `SettingsMenu.svelte` (desktop)
- theme selection: dark / light / system (follows OS preference)
- accent color customization
- auto-play next track setting
- hidden tags for discovery feed filtering
- persisted to backend via `/preferences/` API
- localStorage fallback for offline access
- no dedicated state file - integrated into settings components

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

1. user clicks upload on dedicated `/upload` page (linked from portal or ProfileMenu)
2. `uploader.upload()` called - returns immediately
3. user navigates to homepage
4. homepage renders cached tracks instantly (no blocking)
5. upload completes in background
6. success toast appears with "view track" link
7. cache refreshes, homepage updates with new track

this avoids HTTP/1.1 connection pooling issues by using cached data instead of blocking on fresh fetches during long-running uploads.

### like flow

1. user clicks like button on track
2. `POST /tracks/{id}/like` sent to backend
3. ATProto record created on user's PDS
4. database updated
5. tracks cache invalidated
6. UI reflects updated like status on next cache fetch
7. if error occurs, error logged to console

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

## media session API

the player component (`frontend/src/lib/components/player/Player.svelte`) integrates with the [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API) to provide metadata and controls to external interfaces like:

- **lock screen controls** (iOS/Android)
- **CarPlay / Android Auto**
- **bluetooth devices**
- **macOS control center**

### metadata

when a track plays, we update `navigator.mediaSession.metadata` with:
- title, artist, album
- artwork (track image or artist avatar fallback)

### action handlers

set up in `onMount`, these respond to system media controls:
- `play` / `pause` - toggle playback
- `previoustrack` / `nexttrack` - navigate queue
- `seekto` - jump to position
- `seekbackward` / `seekforward` - skip 10 seconds

### position state

reactive effects keep `navigator.mediaSession.setPositionState()` synced with playback progress, enabling scrubbers on lock screens.

### implementation notes

- handlers are registered once in `onMount`
- metadata updates reactively via `$effect` when `player.currentTrack` changes
- playback state syncs reactively with `player.paused`
- position updates on every `player.currentTime` / `player.duration` change
- gracefully no-ops if `navigator.mediaSession` is unavailable
