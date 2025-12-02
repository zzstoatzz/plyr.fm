# client-side navigation

## preserving player state across navigation

the player lives in the root layout (`+layout.svelte`) and persists across all page navigations. to maintain uninterrupted playback, client-side navigation must work correctly.

## critical rule: never use `stopPropagation()` on links

**problem**: calling `e.stopPropagation()` on link click handlers breaks SvelteKit's client-side router, causing full page reloads that unmount and remount the player.

```svelte
<!-- ❌ WRONG - causes full page reload, interrupts playback -->
<a href="/tag/{tag}" onclick={(e) => e.stopPropagation()}>{tag}</a>
```

```svelte
<!-- ✅ CORRECT - client-side navigation works, playback continues -->
<a href="/tag/{tag}">{tag}</a>
```

## handling links inside clickable containers

when you have links nested inside a clickable button/div, check the event target instead of using `stopPropagation()`:

```svelte
<button
  onclick={(e) => {
    // skip if user clicked a link inside
    if (e.target instanceof HTMLAnchorElement || (e.target as HTMLElement).closest('a')) {
      return;
    }
    doSomething();
  }}
>
  <span>click me</span>
  <a href="/other-page">or click this link</a>
</button>
```

this pattern:
1. lets the link trigger proper client-side navigation
2. only calls `doSomething()` when clicking non-link elements
3. preserves all global state including the player

## why this matters

SvelteKit's client-side router intercepts `<a>` tag clicks to:
- avoid full page reload
- preserve global state (player, queue, auth)
- enable smooth transitions

when `stopPropagation()` is called, the click event never reaches SvelteKit's router, falling back to native browser navigation which:
- performs a full page reload
- unmounts and remounts all components
- resets audio playback

## examples from the codebase

### TrackItem.svelte

the track container is a button that plays the track on click. it contains multiple links (artist, album, tags) that should navigate without affecting playback:

```svelte
<button
  class="track"
  onclick={(e) => {
    // only play if clicking the track itself, not a link inside
    if (e.target instanceof HTMLAnchorElement || (e.target as HTMLElement).closest('a')) {
      return;
    }
    onPlay(track);
  }}
>
  <a href="/u/{track.artist_handle}" class="artist-link">{track.artist}</a>
  <a href="/tag/{tag}" class="tag-badge">{tag}</a>
</button>
```

## debugging navigation issues

**symptom**: clicking a link stops music playback

**diagnosis**:
1. check if the link has `onclick={(e) => e.stopPropagation()}`
2. check parent elements for event handling that might interfere
3. verify the route uses SvelteKit conventions (`+page.svelte`, `+page.ts`)

**fix**: remove `stopPropagation()` and use event target checking in parent handlers instead
