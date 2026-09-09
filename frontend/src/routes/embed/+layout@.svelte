<script lang="ts">
	let { children } = $props();
</script>

<div class="embed-layout">
	{@render children?.()}
</div>

<style>
	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}

	:global(:root) {
		/* backgrounds */
		--bg-primary: #0a0a0a;
		--bg-secondary: #141414;
		--bg-tertiary: #1a1a1a;
		--bg-hover: #1f1f1f;

		/* borders */
		--border-subtle: #282828;
		--border-default: #333333;
		--border-emphasis: #444444;

		/* text */
		--text-primary: #e8e8e8;
		--text-secondary: #b0b0b0;
		--text-tertiary: #808080;
		--text-muted: #666666;

		/* accent */
		--accent: #6a9fff;

		/* type */
		--text-sm: 0.85rem;
		--text-xs: 0.75rem;
		--text-lg: 1rem;
		--text-3xl: 1.5rem;
		--radius-sm: 4px;
		--radius-md: 8px;
		--error: #ef4444;
		--embed-space: clamp(12px, 3vw, 24px);
		--embed-gap: 12px;
		--embed-play: 44px;
		font-family:
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
		line-height: 1.4;
		color-scheme: dark;

		/* radii */
		--radius-full: 9999px;
	}

	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
		height: 100%;
		overflow: hidden;
	}

	.embed-layout {
		font-family:
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
		height: 100dvh;
		width: 100%;
	}
	:global(button),
	:global(input) {
		font: inherit;
	}
	:global(button:focus-visible),
	:global(a:focus-visible),
	:global(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	:global(.seek-bar) {
		flex: 1;
		min-width: 0;
		width: 100%;
		height: 24px;
		margin: 0;
		padding: 0;
		appearance: none;
		background: transparent;
		cursor: pointer;
		--fill: var(--text-primary);
	}
	:global(.seek-bar::-webkit-slider-runnable-track) {
		height: 4px;
		border-radius: var(--radius-full);
		background: linear-gradient(
			to right,
			var(--fill) var(--progress),
			var(--border-default) var(--progress)
		);
	}
	:global(.seek-bar::-moz-range-track) {
		height: 4px;
		background: var(--border-default);
		border-radius: var(--radius-full);
	}
	:global(.seek-bar::-moz-range-progress) {
		height: 4px;
		background: var(--fill);
		border-radius: var(--radius-full);
	}
	:global(.seek-bar::-webkit-slider-thumb) {
		appearance: none;
		width: 12px;
		height: 12px;
		margin-top: -4px;
		border-radius: var(--radius-full);
		background: var(--text-primary);
		opacity: 0;
	}
	:global(.seek-bar::-moz-range-thumb) {
		width: 12px;
		height: 12px;
		border: 0;
		border-radius: var(--radius-full);
		background: var(--text-primary);
		opacity: 0;
	}
	:global(.seek-bar:hover),
	:global(.seek-bar:focus-visible) {
		--fill: var(--accent);
	}
	:global(.seek-bar:hover::-webkit-slider-thumb),
	:global(.seek-bar:focus-visible::-webkit-slider-thumb) {
		opacity: 1;
	}
	:global(.seek-bar:hover::-moz-range-thumb),
	:global(.seek-bar:focus-visible::-moz-range-thumb) {
		opacity: 1;
	}
	:global(.seek-bar:disabled) {
		opacity: 0.4;
		cursor: default;
	}
	@media (pointer: coarse) {
		:global(.seek-bar::-webkit-slider-thumb),
		:global(.seek-bar::-moz-range-thumb) {
			opacity: 1;
		}
	}
</style>
