<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { auth, restoreAuth } from '$lib/auth';
	import { player } from '$lib/player.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import NowPlaying from '$lib/NowPlaying.svelte';
	import PlayQueue from '$lib/PlayQueue.svelte';
	import PlayerDock from '$lib/PlayerDock.svelte';
	import { uploadActivity } from '$lib/upload-activity.svelte';
	import '../app.css';

	let { children } = $props();
	let dialog: HTMLDialogElement;
	let account = $state.raw(auth.getAuth());
	let uploading = $derived(uploadActivity.jobs.filter(job => job.owner === account.did && job.phase !== 'done' && job.phase !== 'failed').length);
	const links = [
		{ path: '/', label: 'home', icon: 'home' },
		{ path: '/search', label: 'search', icon: 'search' },
		{ path: '/library', label: 'library', icon: 'library' },
		{ path: '/queue', label: 'queue', icon: 'queue' }
	] as const;

	onMount(() => {
		let resumed = account.rpc;
		const unsubscribe = auth.subscribe(() => {
			account = auth.getAuth();
			if (resumed === account.rpc) return;
			resumed = account.rpc;
			const owner = account.did;
			const rpc = account.rpc;
			if (owner && account.uploadStorage) {
				void import('$lib/upload').then(({ uploadQueue }) => {
					if (auth.getAuth().rpc === rpc) return uploadQueue.resume(owner);
				}).catch(() => {});
			}
		});
		const stop = player.mount();
		void restoreAuth();
		return () => { unsubscribe(); stop(); };
	});
	$effect(() => {
		// Queue snapshots, rather than the media clock, trigger checkpoint writes.
		player.snapshot.state;
		player.repeat;
		player.keepPlaying;
		untrack(() => player.save());
	});
	$effect(() => {
		if (player.nowPlaying && !dialog.open) dialog.showModal();
		else if (!player.nowPlaying && dialog.open) dialog.close();
	});

	function shortcuts(event: KeyboardEvent) {
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || !player.current) return;
		if (event.target instanceof HTMLElement && event.target.closest('button, a, input, select, textarea, [contenteditable]')) return;
		if (event.code === 'Space') { event.preventDefault(); player.toggle(); }
		else if (event.key === 'ArrowLeft') { event.preventDefault(); player.seek(player.position - 5); }
		else if (event.key === 'ArrowRight') { event.preventDefault(); player.seek(player.position + 5); }
	}
</script>

<svelte:window onkeydown={shortcuts} />
<a class="skip" href="#main">skip to content</a>

<div data-testid="app-frame" class="frame" class:hasPlayer={!!player.current} class:docked={player.queueOpen}>
	<nav aria-label="Main navigation">
		<a class="brand" aria-label="plyr.fm home" href="/"><span aria-hidden="true">✻</span> plyr.fm</a>
		{#each links as link (link.path)}
			<a href={link.path} class:active={page.url.pathname === link.path} aria-current={page.url.pathname === link.path ? 'page' : undefined}>
				<Icon name={link.icon} size={21} /> <span>{link.label}</span>
			</a>
		{/each}
		<a href="/upload" class:active={page.url.pathname === '/upload'} aria-current={page.url.pathname === '/upload' ? 'page' : undefined}>
			<Icon name="upload" size={21} /><span>{uploading ? `uploading ${uploading}` : 'upload'}</span>
		</a>
		{#if account.did}
			<a href="/settings" class:active={page.url.pathname === '/settings'}><Icon name="settings" size={21} /><span>settings</span></a>
		{:else}
			<a href={'/login?' + new URLSearchParams({ return_to: page.url.pathname + page.url.search })} class:active={page.url.pathname === '/login'}><Icon name="logout" size={21} /><span>sign in</span></a>
		{/if}
	</nav>
	<main id="main" tabindex="-1">{@render children()}</main>
	{#if player.queueOpen}
		<aside data-testid="queue-panel"><PlayQueue close={() => { player.queueOpen = false; }} /></aside>
	{/if}
</div>

<PlayerDock />
<dialog bind:this={dialog} aria-label="Now playing" onclose={() => { player.nowPlaying = false; }}>
	{#if player.nowPlaying}<NowPlaying close={() => { player.nowPlaying = false; }} />{/if}
</dialog>

<style>
	.frame { min-height: 100dvh; display: grid; grid-template-columns: var(--sidebar) minmax(0, 1fr); }
	.frame.hasPlayer { padding-bottom: var(--dock); }
	.frame.docked { grid-template-columns: var(--sidebar) minmax(0, 1fr) var(--queue); }
	nav { position: sticky; top: 0; align-self: start; min-height: 100dvh; display: flex; flex-direction: column; gap: 0.3rem; padding: 0.9rem; background: var(--surface); border-right: 1px solid var(--line); }
	nav a { display: flex; align-items: center; gap: 0.7rem; padding: 0.65rem 0.8rem; border-radius: 0.7rem; min-height: 2.75rem; color: var(--muted); }
	nav a:hover { text-decoration: none; background: var(--raised); }
	nav a.active { background: var(--hover); color: var(--text); font-weight: 650; }
	nav .brand { font-weight: 750; font-size: 1.4rem; letter-spacing: -0.04em; color: var(--text); margin-bottom: 0.7rem; }
	.brand span { color: var(--accent); }
	main { min-width: 0; }
	aside { position: sticky; top: 0; align-self: start; min-width: 0; height: calc(100dvh - var(--dock)); overflow-y: auto; border-left: 1px solid var(--line); background: var(--surface); }
	dialog { width: min(36rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 1.2rem; padding: 0; }
	dialog::backdrop { background: rgb(0 0 0 / 0.65); }
	@media (min-width: 721px) and (max-width: 1199px) {
		.frame.docked { grid-template-columns: var(--sidebar) minmax(0, 1fr); }
		aside { position: fixed; z-index: 8; right: 0; bottom: var(--dock); top: auto; height: auto; max-height: calc(100dvh - var(--dock)); width: min(var(--queue), calc(100vw - var(--sidebar))); box-shadow: 0 0 2rem rgb(0 0 0 / 0.15); }
	}
	@media (max-width: 720px) {
		.frame, .frame.docked { display: block; padding-bottom: calc(var(--tabs) + env(safe-area-inset-bottom)); }
		.frame.hasPlayer { padding-bottom: calc(var(--tabs) + var(--dock) + env(safe-area-inset-bottom)); }
		aside, nav .brand { display: none; }
		nav { z-index: 9; position: fixed; inset: auto 0 0; min-height: var(--tabs); flex-direction: row; padding: 0 0 env(safe-area-inset-bottom); border: 0; border-top: 1px solid var(--line); }
		nav a { gap: 0.2rem; flex-direction: column; justify-content: center; flex: 1; min-height: var(--tabs); padding: 0.15rem; border-radius: 0; font-size: 0.75rem; }
		dialog { width: 100%; max-width: 100%; height: 100dvh; max-height: 100dvh; margin: 0; border: 0; border-radius: 0; }
	}
</style>
