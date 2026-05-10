# multi-tab playback coordination issue

**date**: 2025-11-04
**branch**: `feat/cross-tab-queue-sync`
**status**: unresolved

## problem statement

we successfully implemented cross-tab queue synchronization using BroadcastChannel. the queue state now syncs perfectly between tabs (no more 409 conflicts). however, there's a critical issue with playback:

**the symptom**: when auto-advance is enabled and a track ends, the queue advances to the next track correctly, but the next track does not start playing. playback just stops.

**expected behavior**: when a track ends in tab 1 with auto-advance enabled, the next track should load and start playing automatically in tab 1.

**actual behavior**: the queue index advances to the next track, the UI updates to show the new track, but audio playback does not start. the player remains paused.

## context

### what we built (successfully)

- cross-tab queue synchronization via BroadcastChannel (commit e4bd8f2)
- when one tab updates the queue, it broadcasts to other tabs
- other tabs fetch the latest state to stay in sync
- no more 409 conflicts from concurrent queue mutations

### the new requirement

we need to ensure that when auto-advance happens:
1. only the tab that was playing should continue playing the next track
2. other tabs should update their UI but not take over audio playback

### relevant code structure

**`frontend/src/lib/queue.svelte.ts`**:
- Queue class with reactive state using Svelte 5 runes
- Methods: `next()`, `previous()`, `goTo()`, etc.
- BroadcastChannel setup in `initialize()`
- `pushQueue()` sends updates to server and broadcasts to other tabs

**`frontend/src/lib/components/Player.svelte`**:
- Manages audio playback state
- Syncs with queue state via reactive effects
- Has a loading mechanism: when track changes, it loads the new audio file
- Has `shouldAutoPlay` flag to indicate playback should start after loading completes

**key flow**:
1. Track ends → `handleTrackEnded()` calls `queue.next()`
2. `queue.next()` increments index, schedules push to server
3. Effect in Player.svelte sees queue change, loads new track
4. After loading completes, should auto-play if conditions are met

## attempted solutions

### attempt 1: add `lastUpdateWasLocal` flag

**approach**:
- added reactive `lastUpdateWasLocal = $state(true)` to Queue class
- set to `true` at start of all local mutation methods (next, previous, etc.)
- set to `false` when receiving BroadcastChannel message from another tab
- in Player.svelte, only auto-play when `queue.lastUpdateWasLocal` is true

**code changes**:
```typescript
// in queue.svelte.ts
lastUpdateWasLocal = $state(true);

next() {
  if (this.currentIndex < this.tracks.length - 1) {
    this.lastUpdateWasLocal = true;  // mark as local
    this.currentIndex += 1;
    this.schedulePush();
  }
}

// in Player.svelte
if (trackChanged) {
  player.currentTrack = queue.currentTrack;
  if (queue.lastUpdateWasLocal) {
    player.paused = false;  // only auto-play for local updates
  }
}
```

**result**: auto-advance stopped working entirely. queue advanced but playback didn't start.

### attempt 2: use `shouldAutoPlay` flag instead

**change**: instead of setting `player.paused = false` directly, set `shouldAutoPlay = true` to let the loading mechanism handle it:

```typescript
if (trackChanged) {
  player.currentTrack = queue.currentTrack;
  if (queue.lastUpdateWasLocal) {
    shouldAutoPlay = true;  // changed from player.paused = false
  }
}
```

**result**: same problem. queue advanced but playback didn't start.

### attempt 3: ignore own broadcasts

**hypothesis**: maybe the tab receives its own broadcast and sets `lastUpdateWasLocal = false`, breaking auto-play

**change**: ignore broadcasts with the same revision number we already have:

```typescript
this.channel.onmessage = (event) => {
  if (event.data.type === 'queue-updated') {
    // ignore our own broadcasts
    if (event.data.revision === this.revision) {
      return;
    }

    this.lastUpdateWasLocal = false;
    void this.fetchQueue(true);
  }
};
```

**result**: same problem. queue still advances but playback doesn't start.

## what we observe

1. **auto-advance IS happening**: the queue index increments, UI updates to show next track
2. **loading IS happening**: the audio element src changes, loading events fire
3. **playback is NOT starting**: despite `shouldAutoPlay = true`, the track doesn't play
4. **manual controls work fine**: clicking next/previous buttons works and plays the next track

## debugging notes

### what should happen (original code before our changes)

```typescript
// original Player.svelte effect
if (trackChanged) {
  player.playTrack(queue.currentTrack);  // this worked
  previousQueueIndex = queue.currentIndex;
}
```

where `playTrack()` is:
```typescript
playTrack(track: Track) {
  if (this.currentTrack?.id === track.id) {
    this.paused = !this.paused;
  } else {
    this.currentTrack = track;
    this.paused = false;  // sets paused immediately
  }
}
```

the original code set `paused = false` immediately when the track changed, and another effect handled waiting for loading:

```typescript
// sync paused state with audio element
$effect(() => {
  if (!player.audioElement || isLoadingTrack) return;  // waits for loading

  if (player.paused) {
    player.audioElement.pause();
  } else {
    player.audioElement.play().catch(err => {
      console.error('playback failed:', err);
      player.paused = true;
    });
  }
});
```

### the issue with our changes

we're trying to conditionally set `paused = false` or `shouldAutoPlay = true` based on `queue.lastUpdateWasLocal`, but something in this flow is breaking.

possibilities:
1. timing issue: `lastUpdateWasLocal` gets reset before the effect runs?
2. effect dependency issue: effects not firing in the right order?
3. reactive state not updating when we think it is?
4. the flag is working but something else is preventing playback?

## what to investigate

1. **add console.log statements** to trace the exact flow:
   - when `queue.next()` is called
   - value of `lastUpdateWasLocal` at each step
   - when Player effect runs and what it sees
   - when `shouldAutoPlay` gets set and what happens next

2. **check Logfire traces** for the auto-advance flow to see what's happening server-side and in the queue sync

3. **consider alternative approaches**:
   - instead of a flag, track which tab ID is "active player"?
   - use a different mechanism to coordinate playback across tabs?
   - accept that all tabs will try to play and rely on browser to handle it?

4. **verify the issue isn't elsewhere**:
   - does `handleTrackEnded()` actually call `queue.next()`?
   - is auto-advance preference actually enabled when this happens?
   - is there an error being swallowed somewhere?

## original issue this was trying to solve

from STATUS.md:

> when a track ends and auto-advances to the next track, **both tabs** receive the queue update and try to start playing the new track. the browser only allows one tab to play audio at a time, so it alternates which tab "wins" the audio playback race.

so the original problem was: tabs switch back and forth randomly.
now the problem is: no tabs play at all.

## files modified

- `frontend/src/lib/queue.svelte.ts`: added `lastUpdateWasLocal` flag and broadcast filtering
- `frontend/src/lib/components/Player.svelte`: conditional auto-play based on flag

## next steps for whoever picks this up

1. review the original code flow without our changes (git diff HEAD~1)
2. add detailed logging to understand when and why playback isn't starting
3. consider whether the `lastUpdateWasLocal` approach is fundamentally flawed
4. maybe the solution is simpler: just let the original behavior work and accept that tabs might occasionally switch?
5. or maybe we need a different coordination mechanism entirely

good luck. i'm sorry i couldn't solve this.
