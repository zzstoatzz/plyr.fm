<script lang="ts">
	// social-app's Layout.Header: back button, title (+ subtitle), and a
	// balancing slot on the right for one action.
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		title,
		subtitle,
		back = true,
		slot
	}: { title: string; subtitle?: string; back?: boolean; slot?: Snippet } = $props();

	function goBack() {
		if (history.length > 1) history.back();
		else location.href = '/';
	}
</script>

<header class="screen-header">
	{#if back}
		<button class="btn ghost icon" onclick={goBack} aria-label="back"><Icon name="back" /></button>
	{:else}
		<span class="slot"></span>
	{/if}
	<div class="content">
		<h1 class="ellipsis">{title}</h1>
		{#if subtitle}<p class="ellipsis muted small">{subtitle}</p>{/if}
	</div>
	<span class="slot">{#if slot}{@render slot()}{/if}</span>
</header>

<style>
	.screen-header {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: var(--s-sm);
		min-height: 52px;
		padding: var(--s-xs) var(--s-sm);
		padding-top: max(var(--s-xs), env(safe-area-inset-top));
		background: color-mix(in srgb, var(--c-0) 88%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--c-50);
	}
	.content {
		flex: 1;
		min-width: 0;
		text-align: center;
	}
	h1 {
		font-size: var(--t-lg);
		font-weight: 700;
	}
	p {
		margin: 0;
	}
	.slot {
		display: inline-flex;
		justify-content: flex-end;
		min-width: 36px;
	}
	@media (min-width: 800px) {
		.content {
			text-align: left;
		}
	}
</style>
