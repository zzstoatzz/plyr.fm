<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Tab {
		id: string;
		label: string;
	}

	let {
		tabs,
		active = $bindable(tabs[0]?.id ?? ''),
		header,
		pane
	}: {
		tabs: Tab[];
		active?: string;
		/** collapsing content rendered above the sticky tab bar (scrolls away) */
		header?: Snippet;
		/** renders a tab's content; called once per tab (all panes stay mounted) */
		pane: Snippet<[string]>;
	} = $props();

	let tablistEl = $state<HTMLDivElement>();

	// publish the tab-bar height so a pane's own sticky toolbar (e.g. the tracks
	// search/sort bar) can sit just beneath it: top = header + tab-bar.
	let tabbarHeight = $state(0);
	$effect(() => {
		if (typeof document !== 'undefined') {
			document.documentElement.style.setProperty('--pager-tabbar-height', `${tabbarHeight}px`);
		}
	});

	function onKeydown(event: KeyboardEvent) {
		const idx = tabs.findIndex((t) => t.id === active);
		if (idx === -1) return;
		let next: number;
		if (event.key === 'ArrowRight') next = (idx + 1) % tabs.length;
		else if (event.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
		else return;
		event.preventDefault();
		active = tabs[next].id;
		tablistEl?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
	}
</script>

{#if header}
	<div class="pager-header">{@render header()}</div>
{/if}

<div class="pager-tabbar" bind:this={tablistEl} bind:clientHeight={tabbarHeight} role="tablist">
	{#each tabs as tab (tab.id)}
		<button
			role="tab"
			id="tab-{tab.id}"
			aria-selected={tab.id === active}
			aria-controls="panel-{tab.id}"
			tabindex={tab.id === active ? 0 : -1}
			class="pager-tab"
			class:active={tab.id === active}
			onclick={() => (active = tab.id)}
			onkeydown={onKeydown}
		>
			{tab.label}
		</button>
	{/each}
</div>

{#each tabs as tab (tab.id)}
	<div
		role="tabpanel"
		id="panel-{tab.id}"
		aria-labelledby="tab-{tab.id}"
		class="pager-pane"
		hidden={tab.id !== active}
	>
		{@render pane(tab.id)}
	</div>
{/each}

<style>
	.pager-tabbar {
		position: sticky;
		top: var(--header-height, 0px);
		z-index: 20;
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1.5rem;
		background: var(--bg-primary);
		border-bottom: 1px solid var(--border-subtle);
	}

	.pager-tab {
		appearance: none;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		padding: 0.65rem 0.9rem;
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
		white-space: nowrap;
	}

	.pager-tab:hover {
		color: var(--text-secondary);
	}

	.pager-tab.active {
		color: var(--text-primary);
		border-bottom-color: var(--accent);
	}

	.pager-tab:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
		border-radius: var(--radius-sm);
	}

	.pager-pane[hidden] {
		display: none;
	}

	@media (max-width: 600px) {
		.pager-tabbar {
			margin-bottom: 1.25rem;
		}

		.pager-tab {
			flex: 1;
			text-align: center;
			padding: 0.6rem 0.5rem;
		}
	}
</style>
