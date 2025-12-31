# frontend

SvelteKit with bun (not npm/pnpm).

key patterns:
- **state**: global managers in `lib/*.svelte.ts` using `$state` runes (player, queue, uploader, tracks cache)
- **components**: reusable ui in `lib/components/` (LikeButton, Toast, Player, etc)
- **routes**: pages in `routes/` with `+page.svelte` and `+page.ts` for data loading
- **design tokens**: use CSS variables from `+layout.svelte` - never hardcode colors, radii, or font sizes (see `docs/frontend/design-tokens.md`)

gotchas:
- **svelte 5 runes mode**: component-local state MUST use `$state()` - plain `let` has no reactivity (see `docs/frontend/state-management.md`)
- toast positioning: bottom-left above player footer (not top-right)
- queue sync: uses BroadcastChannel for cross-tab, not SSE
- preferences: managed in UserMenu (desktop) and ProfileMenu (mobile) components, not dedicated state file
- keyboard shortcuts: handled in root layout (+layout.svelte), with context-aware filtering