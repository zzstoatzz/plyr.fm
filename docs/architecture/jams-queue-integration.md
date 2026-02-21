# jams + queue integration

## big picture

a jam is "your queue, but shared." when you start a jam, your queue becomes a shared space. anyone in the jam can play a track, skip, reorder, add tracks — same as they would with their own queue. the player footer handles all playback. there's no separate "jam page" or "jam player."

from the user's perspective, nothing changes about how they interact with the app. they click a track, it plays. they hit next, it skips. the only difference is that everyone in the jam sees and hears the same thing.

## the problem

the current implementation sprinkles `if (jam.active)` conditionals everywhere:

- `playback.svelte.ts`: `if (jam.active) jam.playTrack() else queue.playNow()`
- `PlaybackControls.svelte`: `if (jam.active) jam.play() else player.togglePlayPause()`
- `Queue.svelte`: `if (jam.active) jam.setIndex() else goToIndex()`
- `Player.svelte`: jam-pause-sync effect, drift correction effect

every file that touches the queue needs to know about jams. every new feature that interacts with playback needs jam-awareness. this doesn't scale and it's fragile — we already missed `playback.svelte.ts` entirely, which meant clicking a track in the feed did nothing during a jam.

## the constraint

circular imports. `jam.svelte.ts` already imports `queue.svelte.ts` (for `stopPositionSave`/`startPositionSave`). so `queue.svelte.ts` can't import `jam.svelte.ts` back.

## the design

the queue is the single integration point. when a jam is active, the queue routes mutations through the jam's WebSocket instead of local state + REST. callers never know.

### bridge pattern

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

`jam.svelte.ts` registers a bridge with the queue when a jam starts:

```typescript
// jam.svelte.ts — on create/join
queue.setJamBridge({
    playTrack: (fileId) => this.sendCommand({ type: 'play_track', file_id: fileId }),
    next: () => this.sendCommand({ type: 'next' }),
    previous: () => this.sendCommand({ type: 'previous' }),
    addTracks: (ids) => this.sendCommand({ type: 'add_tracks', track_ids: ids }),
    removeTrack: (idx) => this.sendCommand({ type: 'remove_track', index: idx }),
    setIndex: (idx) => this.sendCommand({ type: 'set_index', index: idx }),
    seek: (ms) => this.sendCommand({ type: 'seek', position_ms: ms }),
    play: () => this.sendCommand({ type: 'play' }),
    pause: () => this.sendCommand({ type: 'pause' }),
});

// jam.svelte.ts — on leave/destroy
queue.setJamBridge(null);
```

queue methods check the bridge first:

```typescript
// queue.svelte.ts
playNow(track: Track) {
    if (this.jamBridge) {
        this.jamBridge.playTrack(track.file_id);
        return;
    }
    // ... normal local logic
}
```

### what this fixes

- `playback.svelte.ts` — no jam imports, no conditionals. `queue.playNow()` just works.
- `PlaybackControls.svelte` — calls `queue.next()` / `player.togglePlayPause()`. queue handles routing.
- `Queue.svelte` — calls `goToIndex()` / `queue.removeTrack()`. no jam conditionals.
- feed track clicks — already go through `playback.svelte.ts` → `queue.playNow()`. automatically jam-aware.

### state flow (jam active)

incoming jam state (from WebSocket) updates the queue's reactive state directly:

1. jam WS message arrives with new state
2. `jam.handleStateMessage()` updates `jam.tracks`, `jam.currentIndex`, `jam.isPlaying`, etc.
3. queue reads from jam state when bridge is set (or jam pushes state into queue)
4. Player.svelte's existing queue-to-player sync picks it up

### what stays the same

- the `<audio>` element and Player.svelte's track loading / play-pause sync
- the backend jam service (commands, Redis Streams, WebSocket fan-out)
- the jam UI in Queue.svelte (rainbow border, participants, share/leave)
- the `/jam/[code]` join redirect page

### what changes

| file | change |
|------|--------|
| `queue.svelte.ts` | add `JamBridge` interface + `setJamBridge()`, check bridge in mutation methods |
| `jam.svelte.ts` | register/unregister bridge on create/join/leave/destroy |
| `playback.svelte.ts` | remove jam import + conditionals (revert to original) |
| `PlaybackControls.svelte` | remove jam conditionals, use queue/player directly |
| `Queue.svelte` | remove jam routing in click/remove handlers, use queue methods |
| `Player.svelte` | simplify jam effects (may still need pause-sync + drift correction) |
