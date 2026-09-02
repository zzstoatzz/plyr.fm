# frontend

SvelteKit with bun (not npm/pnpm).

key patterns:
- **state**: global managers in `lib/*.svelte.ts` using `$state` runes (player, queue, uploader, tracks cache; `staged-transfer.svelte.ts` is a per-upload state object the uploader hands out)
- **components**: reusable ui in `lib/components/` (LikeButton, Toast, Player, etc)
- **routes**: pages in `routes/` with `+page.svelte` and `+page.ts` for data loading
- **design tokens**: use CSS variables from `+layout.svelte` - never hardcode colors, radii, or font sizes (see `docs/internal/frontend/design-tokens.md`)

gotchas:
- **svelte 5 runes mode**: component-local state MUST use `$state()` - plain `let` has no reactivity (see `docs/internal/frontend/state-management.md`)
- toast positioning: bottom-left above player footer (not top-right)
- queue sync: uses BroadcastChannel for cross-tab, not SSE
- preferences: managed in UserMenu (desktop) and ProfileMenu (mobile) components, not dedicated state file
- keyboard shortcuts: handled in root layout (+layout.svelte), with context-aware filtering
- keyboard seeks go through `queue.seekBy()` at a fixed 10 s; the player's skip buttons (flag `skip-buttons`) use the duration ladder in `lib/skip-step.ts` — two rules on purpose
- flag-gated UI reads `auth.user?.enabled_flags` against a constant in `lib/config.ts`; never ship a flagged feature into the public docs as if it were GA
- icons with text inside an svg inside a `<button>`: the button must `font-family: inherit` or the text renders in the UA font, not the app's `--font-family`; serif fonts need `font-variant-numeric: lining-nums`
- the passing-comment bubbles on the track page measure their room from the DOM (`lib/comment-emission.ts`); don't place them by rule — see `docs/internal/frontend/passing-comments.md`
