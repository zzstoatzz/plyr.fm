<script lang="ts">
	import { eq } from '$lib/eq.svelte';
	import EqPanel from './EqPanel.svelte';

	let open = $state(false);
	let root = $state<HTMLDivElement | null>(null);

	function onWindowPointerDown(event: PointerEvent) {
		if (open && root && event.target instanceof Node && !root.contains(event.target)) open = false;
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			open = false;
			root?.querySelector<HTMLButtonElement>('.eq-btn')?.focus();
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<div class="eq" bind:this={root}>
	<button
		type="button"
		class="eq-btn"
		class:open
		class:shaping={eq.shaping}
		aria-expanded={open}
		aria-haspopup="dialog"
		aria-label="equalizer"
		title="equalizer"
		onclick={() => (open = !open)}
	>
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		>
			<line x1="5" y1="4" x2="5" y2="20" class="rail"></line>
			<line x1="12" y1="4" x2="12" y2="20" class="rail"></line>
			<line x1="19" y1="4" x2="19" y2="20" class="rail"></line>
			<line x1="2.5" y1="14" x2="7.5" y2="14" class="cap cap-a"></line>
			<line x1="9.5" y1="8" x2="14.5" y2="8" class="cap cap-b"></line>
			<line x1="16.5" y1="12" x2="21.5" y2="12" class="cap cap-c"></line>
		</svg>
	</button>
	{#if open}
		<div class="popover" role="dialog" aria-label="equalizer">
			<EqPanel />
		</div>
	{/if}
</div>

<style>
	.eq {
		position: relative;
		display: inline-flex;
	}

	.eq-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		background: transparent;
		border: none;
		border-radius: var(--radius-full);
		color: var(--text-secondary);
		cursor: pointer;
		position: relative;
		transition: color 150ms var(--ease-surface);
	}

	.eq-btn:hover,
	.eq-btn.open {
		color: var(--text-primary);
	}

	.eq-btn.shaping {
		color: var(--accent);
	}

	.eq-btn.shaping::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: 1px;
		width: 4px;
		height: 4px;
		border-radius: var(--radius-full);
		background: var(--accent);
		translate: -50% 0;
	}

	.eq-btn:focus-visible {
		outline: 2px solid var(--text-primary);
		outline-offset: 2px;
	}

	.rail {
		opacity: 0.35;
	}

	.cap {
		transition: translate 300ms var(--ease-surface);
	}

	.eq-btn:hover .cap-a {
		translate: 0 -4px;
	}

	.eq-btn:hover .cap-b {
		translate: 0 6px;
	}

	.eq-btn:hover .cap-c {
		translate: 0 -3px;
	}

	.popover {
		position: absolute;
		right: -0.5rem;
		bottom: calc(100% + 1rem);
		width: 340px;
		padding: 1rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		box-shadow: 0 12px 32px color-mix(in srgb, var(--bg-primary) 60%, transparent);
		z-index: 120;
		transform-origin: bottom right;
		animation: rise 180ms var(--ease-surface);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.98);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.cap,
		.popover {
			transition: none;
			animation: none;
		}
	}
</style>
