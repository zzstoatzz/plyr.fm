# double loading state analysis

## problem
On hard refresh of homepage:
1. Tracks appear immediately (from cache)
2. "loading tracks..." appears briefly
3. Tracks appear again

## root cause

**frontend/src/lib/tracks.svelte.ts:**
```typescript
class TracksCache {
    tracks = $state<Track[]>(loadCachedTracks());  // loads from localStorage immediately
    loading = $state(false);  // starts as false

    async fetch(force = false): Promise<void> {
        if (!force && this.loading) return;

        this.loading = true;  // <-- THIS causes the loading UI to show
        // ... fetch from server
        this.loading = false;
    }
}
```

**frontend/src/routes/+page.svelte:**
```typescript
let tracks = $derived(tracksCache.tracks);  // has cached data immediately
let loadingTracks = $derived(tracksCache.loading);  // false, then true, then false

onMount(async () => {
    // ...
    tracksCache.fetch();  // triggers loading = true
});
```

**Render sequence:**
1. Initial render: `tracks.length > 0` (cached), `loading = false` → shows tracks
2. `fetch()` called: `loading = true` → shows "loading tracks..."
3. Fetch completes: `loading = false`, `tracks` updated → shows tracks again

## solution

Only show loading state if we don't have cached data:

```typescript
// +page.svelte
let showLoading = $derived(loadingTracks && tracks.length === 0);

{#if showLoading}
    <p class="loading-text">loading tracks...</p>
{:else if !hasTracks}
    <p class="empty">no tracks yet</p>
{:else}
    <!-- tracks -->
{/if}
```

This way:
- If we have cached tracks → show them while fetching in background
- If we don't have cached tracks → show loading state
- No flicker between states
