# player scroll and positioning issues

## problems

1. **Gap at bottom of screen**: White/gray bar visible between player bottom and screen bottom on mobile
2. **Content cut off**: Can't scroll far enough to see last track - it's hidden behind/below the player

## root cause

**frontend/src/routes/+page.svelte (line 89):**
```css
main {
    padding: 0 1rem 120px;  /* hardcoded 120px */
}
```

**frontend/src/lib/components/Player.svelte (lines 304-313):**
```css
.player {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 1rem 2rem;
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
    /* actual height varies by content + safe area */
}
```

## issue 1: hardcoded padding doesn't match dynamic player height

The homepage uses `120px` bottom padding, but:
- Player height varies based on content and layout
- On mobile with safe area insets, player can be taller
- Gap appears because padding doesn't match actual player height

## issue 2: safe area insets not properly handled

The player uses `env(safe-area-inset-bottom)` for its own padding, but the page content doesn't account for this. So:
- Player sits at `bottom: 0` (correct)
- But its internal padding pushes content up
- Page padding doesn't account for this extra space
- Last track gets cut off

## solution

Use the same dynamic `--player-height` variable we created in PR #101:

**frontend/src/routes/+page.svelte:**
```css
main {
    max-width: 800px;
    margin: 0 auto;
    padding: 0 1rem calc(var(--player-height, 120px) + env(safe-area-inset-bottom, 0px));
}
```

This ensures:
- Bottom padding matches actual player height
- Safe area insets are accounted for
- No gap at bottom of screen
- All content scrollable
