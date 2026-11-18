<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { toast, type Toast } from '$lib/toast.svelte';
	import Icon from './Icon.svelte';

	function run(item: Toast) {
		toast.dismiss(item.id);
		item.action?.run();
	}
</script>

<div class="toasts" role="region" aria-live="polite" aria-label="notifications">
	{#each toast.items as item (item.id)}
		<div class="toast" data-testid="toast" role={item.type === 'error' ? 'alert' : undefined} in:fly={{ y: 8, duration: 200 }} out:fade={{ duration: 400 }}>
			{#if item.action}
				<button type="button" onclick={() => run(item)}>
					<span class="icon {item.type}"><Icon name={item.type === 'error' ? 'x' : 'check'} size={16} /></span>
					<span class="message">{item.message}</span>
					<span class="action">{item.action.label} ›</span>
				</button>
			{:else}
				<span class="row">
					<span class="icon {item.type}"><Icon name={item.type === 'error' ? 'x' : 'check'} size={16} /></span>
					<span class="message">{item.message}</span>
				</span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.toasts { position: fixed; z-index: 20; left: calc(var(--sidebar) + 1rem); bottom: calc(var(--toast-dock, 0px) + 1rem); display: grid; justify-items: start; gap: 0.5rem; pointer-events: none; max-width: calc(100vw - var(--sidebar) - 2rem); }
	.toast { pointer-events: auto; max-width: 100%; border: 1px solid var(--line); border-radius: 0.7rem; background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(12px); box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 0.18); color: var(--text); font-size: 0.875rem; }
	.toast button, .row { display: flex; align-items: center; gap: 0.6rem; min-height: 2.75rem; padding: 0.55rem 0.9rem; width: 100%; border: 0; background: none; color: inherit; font: inherit; text-align: start; border-radius: inherit; }
	.toast button { cursor: pointer; }
	.toast button:hover { background: var(--hover); }
	.message { min-width: 0; overflow-wrap: anywhere; }
	.icon { display: grid; flex: none; color: var(--muted); }
	.icon.success { color: var(--accent); }
	.icon.error { color: #ef4444; }
	.action { flex: none; color: var(--accent); font-weight: 650; white-space: nowrap; }
	@media (max-width: 720px) {
		.toasts { left: 0.75rem; right: 0.75rem; max-width: none; justify-items: stretch; bottom: calc(var(--tabs) + var(--toast-dock, 0px) + env(safe-area-inset-bottom) + 0.6rem); }
	}
</style>
