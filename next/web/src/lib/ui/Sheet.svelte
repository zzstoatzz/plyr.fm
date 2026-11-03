<script lang="ts">
	// a native <dialog>: slides up from the bottom on phones, centered on
	// wider screens (social-app's Dialog). escape and the backdrop close it.
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		title,
		full = false,
		onclose,
		children
	}: { open?: boolean; title?: string; full?: boolean; onclose?: () => void; children: Snippet } = $props();
	let el = $state<HTMLDialogElement>();

	$effect(() => {
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	});
</script>

<dialog
	bind:this={el}
	class:full
	onclose={() => {
		open = false;
		onclose?.();
	}}
	onclick={(e) => {
		if (e.target === el) el.close();
	}}
	aria-label={title}
>
	{#if open}
		<div class="sheet">
			{#if !full}<span class="handle" aria-hidden="true"></span>{/if}
			{#if title}
				<div class="top">
					<h2>{title}</h2>
					<button class="btn ghost icon sm" onclick={() => el?.close()} aria-label="close"><Icon name="x" size={18} /></button>
				</div>
			{/if}
			{@render children()}
		</div>
	{/if}
</dialog>

<style>
	dialog {
		padding: 0;
		border: 0;
		background: var(--raised);
		color: var(--c-1000);
		width: 100%;
		max-width: 100%;
		margin: auto 0 0;
		max-height: 90dvh;
		border-radius: var(--r-lg) var(--r-lg) 0 0;
		overscroll-behavior: contain;
	}
	dialog[open] {
		animation: up 0.18s ease-out;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.55);
		backdrop-filter: blur(2px);
		-webkit-backdrop-filter: blur(2px);
	}
	/* menus inside sheets: bigger, easier targets */
	dialog :global(.row-item) {
		min-height: 3.5rem;
		font-size: var(--t-lg);
		font-weight: 500;
		gap: var(--s-lg);
	}
	dialog.full {
		max-height: 100dvh;
		height: 100dvh;
		border-radius: 0;
	}
	.sheet {
		padding: var(--s-sm) var(--s-lg) max(var(--s-xl), env(safe-area-inset-bottom));
	}
	.full .sheet {
		height: 100%;
		padding-top: max(var(--s-sm), env(safe-area-inset-top));
	}
	.handle {
		display: block;
		width: 2.25rem;
		height: 0.25rem;
		margin: 0 auto var(--s-sm);
		border-radius: var(--r-full);
		background: var(--c-200);
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--s-md);
	}
	h2 {
		font-size: var(--t-xl);
	}
	@media (min-width: 500px) {
		dialog:not(.full) {
			margin: auto;
			width: min(30rem, calc(100% - 2 * var(--s-lg)));
			border-radius: var(--r-lg);
			box-shadow: 0 0 0 1px var(--c-100), 0 1rem 3rem rgb(0 0 0 / 0.3);
		}
		dialog:not(.full) .handle {
			display: none;
		}
		.sheet {
			padding: var(--s-lg) var(--s-xl) var(--s-xl);
		}
	}
	@media (min-width: 800px) {
		dialog.full {
			margin: auto;
			width: min(35rem, calc(100% - 2 * var(--s-lg)));
			height: auto;
			max-height: 90dvh;
			border-radius: var(--r-lg);
			box-shadow: 0 0 0 1px var(--c-100), 0 1rem 3rem rgb(0 0 0 / 0.3);
		}
	}
	@keyframes up {
		from {
			transform: translateY(1.5rem);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		dialog[open] {
			animation: none;
		}
	}
</style>
