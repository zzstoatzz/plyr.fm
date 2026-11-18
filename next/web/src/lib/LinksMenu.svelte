<script lang="ts">
	import { resolve } from '$app/paths';
	import { api } from './api';
	import Icon from './ui/Icon.svelte';

	let { onShortcuts }: { onShortcuts?: () => void } = $props();
	let dialog: HTMLDialogElement;
	let totals = $state<Awaited<ReturnType<typeof api.stats>>>();
	let requested = false;
	function open() {
		dialog.showModal();
		if (requested) return;
		requested = true;
		void api.stats().then(value => { totals = value; }).catch(() => { requested = false; });
	}

	const links = [
		{ title: 'profile', detail: '@plyr.fm on Bluesky', href: 'https://bsky.app/profile/plyr.fm', icon: 'user' },
		{ title: 'status page', detail: '', href: 'https://status.zzstoatzz.io/@plyr.fm', icon: 'info' },
		{ title: 'source code', detail: 'tangled.org', href: 'https://tangled.org/@zzstoatzz.io/plyr.fm', icon: 'link' },
		{ title: 'documentation', detail: 'docs.plyr.fm', href: 'https://docs.plyr.fm', icon: 'library' },
		{ title: 'report a bug', detail: 'GitHub issues', href: 'https://github.com/zzstoatzz/plyr.fm/issues/new/choose', icon: 'info' }
	] as const;
</script>

<button class="icon-button trigger" type="button" aria-label="Open links menu" aria-haspopup="dialog" onclick={open}>✻</button>
<dialog bind:this={dialog} aria-labelledby="links-title">
	<header>
		<h2 id="links-title">links</h2>
		<form method="dialog"><button class="icon-button" aria-label="Close links"><Icon name="x" size={19} /></button></form>
	</header>
	<nav aria-label="Explore">
		<a href={resolve('/(app)/radio')} onclick={() => dialog.close()}>
			<Icon name="ph_radio" size={21} /><span>radio<small>live station</small></span>
		</a>
		<a href={resolve('/(app)/stats')} onclick={() => dialog.close()}>
			<Icon name="ph_stats" size={21} /><span>stats</span>
		</a>
		<a href={resolve('/(app)/atlas')} onclick={() => dialog.close()}>
			<Icon name="ph_atlas" size={21} /><span>atlas</span>
		</a>
		{#if onShortcuts}
			<button type="button" class="keys" onclick={() => { dialog.close(); onShortcuts(); }}>
				<Icon name="ph_keys" size={21} /><span>keyboard shortcuts<small>press ?</small></span>
			</button>
		{/if}
		{#each links as link (link.href)}
			<a href={link.href} target="_blank" rel="noopener noreferrer">
				<Icon name={link.icon} size={21} /><span>{link.title}{#if link.detail}<small>{link.detail}</small>{/if}</span>
			</a>
		{/each}
	</nav>
	{#if totals}<p class="totals">{totals.tracks.toLocaleString()} tracks · {totals.artists.toLocaleString()} artists</p>{/if}
</dialog>

<style>
	.trigger { color: var(--accent); font-size: 1.35rem; }
	dialog { width: min(22rem, calc(100% - 2rem)); max-height: 85dvh; margin: max(1rem, env(safe-area-inset-top)) auto auto 1rem; padding: 0.65rem; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 1rem; }
	dialog::backdrop { background: rgb(0 0 0 / 0.35); }
	header, nav a { display: flex; align-items: center; }
	header { justify-content: space-between; padding-left: 0.65rem; }
	h2 { font-size: 1rem; }
	nav :is(a, button) { display: flex; align-items: center; width: 100%; border: 0; background: none; text-align: start; font: inherit; color: inherit; cursor: pointer; }
	nav a, nav button { min-height: 2.75rem; gap: 0.85rem; padding: 0.55rem 0.65rem; border-radius: 0.65rem; }
	nav :is(a, button):hover { background: var(--raised); text-decoration: none; }
	small { display: block; color: var(--muted); }
	.totals { padding: 0.7rem 0.65rem 0.3rem; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.86rem; }
	@media (max-width: 720px), (hover: none) { .keys { display: none !important; } }
</style>
