# portals (rendering modals outside parent DOM)

## the problem

when a modal is rendered inside an element with `backdrop-filter`, `transform`, or `filter`, the modal's `position: fixed` becomes relative to that ancestor instead of the viewport. this causes modals to be positioned incorrectly (e.g., appearing off-screen).

the header uses `backdrop-filter` for the glass blur effect, so any modal rendered inside the header will not center properly on the viewport.

## the solution

use `svelte-portal` to render modal content directly on `<body>`, outside the parent DOM hierarchy.

```bash
bun add svelte-portal
```

```svelte
<script>
  import { portal } from 'svelte-portal';
</script>

<div class="menu-backdrop" use:portal={'body'} onclick={close}></div>
<div class="menu-popover" use:portal={'body'}>
  <!-- modal content -->
</div>
```

the `use:portal={'body'}` action moves the element to `document.body` while preserving all svelte reactivity, bindings, and event handlers.

## when to use

use portals for any fixed-position overlay (modals, dropdowns, tooltips) that might be rendered inside:
- elements with `backdrop-filter` (glass effects)
- elements with `transform`
- elements with `filter`
- `position: sticky` containers (in some browsers)

## reference

- [svelte-portal on GitHub](https://github.com/romkor/svelte-portal)
