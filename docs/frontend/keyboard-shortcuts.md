# keyboard shortcuts

global keyboard shortcuts for the plyr.fm frontend.

## implementation

shortcuts are handled in the root layout (`frontend/src/routes/+layout.svelte`) with context-aware filtering to avoid conflicts with form inputs and other interactive elements.

## available shortcuts

### Cmd/Ctrl+K - open search

**location**: `frontend/src/routes/+layout.svelte`

opens the unified search modal for searching tracks, artists, albums, and tags.

**behavior**:
- **Cmd+K** on macOS, **Ctrl+K** on windows/linux
- works from anywhere, including input fields (uses modifier key)
- toggles search modal open/closed
- focuses search input automatically on open

**in-modal navigation**:
- **arrow up/down** - navigate results
- **enter** - select highlighted result
- **esc** - close modal

see [search.md](./search.md) for full documentation.

---

### Q - toggle queue

**location**: `frontend/src/routes/+layout.svelte`

toggles the queue sidebar visibility.

**behavior**:
- works from any page in the app
- ignores when modifier keys are pressed (cmd/ctrl/alt)
- skips when focus is in input/textarea/contenteditable elements
- persists visibility state to localStorage

**desktop**: queue opens as 360px fixed sidebar, content shifts left via `margin-right: 360px`
**mobile**: queue opens as full-screen overlay (no content shift)

**accessibility**:
- toggle button includes `aria-pressed={showQueue}`
- `aria-label="toggle queue (Q)"` for screen readers
- tooltip shows keyboard hint

## adding new shortcuts

when adding keyboard shortcuts:

1. **add handler to root layout** - keeps all shortcuts in one place
2. **filter contexts** - check for modifier keys and active element
3. **prevent conflicts** - avoid letters used in common form inputs
4. **document behavior** - update this file with key, action, and context rules
5. **add accessibility** - include aria-labels and tooltips mentioning the shortcut

### example pattern

```typescript
function handleShortcut(event: KeyboardEvent) {
  // ignore modifiers
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  // ignore in inputs
  const target = event.target as HTMLElement;
  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  ) return;

  // handle key
  if (event.key.toLowerCase() === 'q') {
    event.preventDefault();
    // do something
  }
}

onMount(() => {
  window.addEventListener('keydown', handleShortcut);
});

onDestroy(() => {
  if (browser) {
    window.removeEventListener('keydown', handleShortcut);
  }
});
```

## future candidates

potential shortcuts to consider:
- **space** - play/pause (when not focused on button)
- **arrow keys** - skip forward/back (context-aware)
- **shift + arrow** - navigate queue
- **/** - focus search (alternative to Cmd/Ctrl+K)
- **T** - cycle theme (dark/light/system)

## design principles

1. **global availability** - shortcuts should work from anywhere unless context prevents it
2. **respect focus** - never intercept input from form fields
3. **progressive disclosure** - show hints in tooltips and UI
4. **consistency** - follow common web app conventions where possible
5. **accessibility first** - keyboard shortcuts enhance but don't replace mouse/touch interaction
