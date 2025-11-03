# global state management

## overview

relay uses global state managers following the Svelte 5 runes pattern for cross-component reactive state.

## managers

### player (`src/lib/player.svelte.ts`)
- manages audio playback state globally
- tracks: current track, play/pause, volume, progress
- persists across navigation

### uploader (`src/lib/uploader.svelte.ts`)
- manages file uploads in background
- fire-and-forget pattern - returns immediately
- shows toast notifications for progress/completion
- triggers cache refresh on success

### tracks cache (`src/lib/tracks.svelte.ts`)
- caches track list globally
- 30-second cache window to reduce API calls
- provides instant navigation by serving cached data
- invalidates on new uploads

### toast (`src/lib/toast.svelte.ts`)
- global notification system
- types: success, error, info, warning
- auto-dismiss with configurable duration

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

## upload flow example

1. user clicks upload on portal page
2. `uploader.upload()` called - returns immediately
3. user navigates to homepage
4. homepage renders cached tracks instantly (no blocking)
5. upload completes in background
6. success toast appears
7. cache refreshes, homepage updates with new track

this avoids HTTP/1.1 connection pooling issues by using cached data instead of blocking on fresh fetches during long-running uploads.
