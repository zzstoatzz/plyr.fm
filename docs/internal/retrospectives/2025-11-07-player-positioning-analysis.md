# player positioning analysis

## problems

### 1. hardcoded bottom spacing
**queue toggle button** (`+layout.svelte:193`):
```css
.queue-toggle {
  bottom: 120px; /* hardcoded - assumes player height */
}
```

**problem**: button stays 120px from bottom even when player isn't visible (no track loaded)

**queue padding** (`Queue.svelte:144`):
```css
.queue {
  padding: 1.5rem 1.25rem 140px; /* hardcoded player height assumption */
}
```

**problem**: bottom padding doesn't adjust to actual player presence/height

### 2. mobile browser viewport issues

mobile browsers (especially safari) have dynamic UI bars that change viewport height:
- address bar shows/hides when scrolling
- bottom toolbar shows/hides
- `100vh` doesn't account for these dynamic changes

**player** uses `position: fixed; bottom: 0` which should stick to bottom, but:
- may show gap between player and actual screen bottom on some mobile browsers
- doesn't use `env(safe-area-inset-bottom)` for devices with notches/home indicators

### 3. no dynamic height calculation

player height varies:
- desktop: `~100px` (padding + content)
- mobile: `~200px` (column layout)

but spacing is **hardcoded** everywhere instead of using:
- css variables to communicate player height
- dynamic calculation with javascript
- css environment variables for safe areas

## solution approaches

### option 1: css custom properties (recommended)

set player height as css variable, use throughout:

```css
/* Player.svelte */
.player {
  --player-height: 100px; /* or calculate dynamically */
  position: fixed;
  bottom: 0;
  height: var(--player-height);
}

/* +layout.svelte */
.queue-toggle {
  bottom: calc(var(--player-height, 0px) + 20px);
}

/* Queue.svelte */
.queue {
  padding-bottom: calc(var(--player-height, 0px) + 40px);
}
```

**pros**: simple, css-only, performant
**cons**: requires consistent height, no player = need conditional logic

### option 2: safe area insets + dynamic calculation

use css environment variables for mobile safety:

```css
.player {
  position: fixed;
  bottom: 0;
  /* account for ios notch/home indicator */
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}

.queue-toggle {
  /* stack above player + safe area */
  bottom: calc(var(--player-height, 0px) + env(safe-area-inset-bottom) + 20px);
}
```

**pros**: works with device notches/safe areas
**cons**: more complex calculation

### option 3: conditional rendering based on player state

make queue toggle position conditional on whether player is showing:

```svelte
<button
  class="queue-toggle"
  class:player-visible={player.currentTrack}
  style="bottom: {player.currentTrack ? '120px' : '20px'}"
>
```

**pros**: explicit, easy to understand
**cons**: requires reactive state, inline styles

### option 4: use dvh (dynamic viewport height)

replace `100vh` with `100dvh` (dynamic viewport height):

```css
.queue-sidebar {
  height: 100dvh; /* adjusts for mobile browser UI */
}
```

**pros**: modern, handles mobile browsers automatically
**cons**: newer css, may need fallback for older browsers

## recommended fix

**combination approach**:

1. **add css custom property for player height**
   - set `--player-height` on `:root` when player mounts
   - update when player height changes (desktop/mobile)
   - default to `0px` when no player

2. **use safe area insets**
   - add `env(safe-area-inset-bottom)` to player bottom padding
   - ensures player sits above device notches/home indicators

3. **use dvh for full-height elements**
   - replace `100vh` with `100dvh` where appropriate
   - fallback to `100vh` for older browsers

4. **conditional positioning**
   - queue toggle: `calc(var(--player-height) + 20px + env(safe-area-inset-bottom))`
   - queue padding: `calc(var(--player-height) + 40px + env(safe-area-inset-bottom))`

## implementation

### Player.svelte

```svelte
<script>
  import { onMount } from 'svelte';

  onMount(() => {
    // set player height css variable
    function updatePlayerHeight() {
      const playerEl = document.querySelector('.player');
      if (playerEl) {
        const height = playerEl.offsetHeight;
        document.documentElement.style.setProperty('--player-height', `${height}px`);
      } else {
        document.documentElement.style.setProperty('--player-height', '0px');
      }
    }

    updatePlayerHeight();
    window.addEventListener('resize', updatePlayerHeight);
    return () => window.removeEventListener('resize', updatePlayerHeight);
  });
</script>

<style>
  .player {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 1rem 2rem;
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
  }
</style>
```

### +layout.svelte

```css
.queue-toggle {
  position: fixed;
  bottom: calc(var(--player-height, 0px) + 20px + env(safe-area-inset-bottom, 0px));
  right: 20px;
}

@media (max-width: 768px) {
  .queue-toggle {
    /* on mobile, player is taller - but use same calculation */
    bottom: calc(var(--player-height, 0px) + 20px + env(safe-area-inset-bottom, 0px));
  }
}
```

### Queue.svelte

```css
.queue {
  padding: 1.5rem 1.25rem calc(var(--player-height, 0px) + 40px + env(safe-area-inset-bottom, 0px));
}
```

## benefits

1. **no gaps**: player always flush with screen bottom (using safe-area-insets)
2. **dynamic positioning**: queue toggle moves based on actual player height
3. **conditional**: when no player, everything positioned correctly near bottom
4. **mobile-friendly**: accounts for dynamic browser UI and device notches
5. **maintainable**: single source of truth (--player-height variable)
