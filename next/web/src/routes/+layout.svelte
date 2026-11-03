<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import { player } from '$lib/player.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import AddToPlaylist from '$lib/AddToPlaylist.svelte';
	import Nav from '$lib/Nav.svelte';
	import NowPlaying from '$lib/NowPlaying.svelte';
	import PlayerBar from '$lib/PlayerBar.svelte';
	import TrackMenu from '$lib/TrackMenu.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import '../app.css';

	let { children } = $props();

	prefs.init();
	onMount(() => {
		auth.restore();
	});

	function keys(e: KeyboardEvent) {
		const el = e.target as HTMLElement;
		if (el.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === ' ' && player.current && !el.closest('button, a')) {
			e.preventDefault();
			player.toggle();
		} else if (e.key === 'ArrowRight' && player.current) player.seek(player.time + 5);
		else if (e.key === 'ArrowLeft' && player.current) player.seek(player.time - 5);
	}
</script>

<svelte:window onkeydown={keys} />

<div class="shell" class:playing={!!player.current}>
	<Nav />
	<main>{@render children()}</main>
</div>

<PlayerBar />
<NowPlaying />
<TrackMenu />
<AddToPlaylist />

{#if toast.message}
	<div class="toast" role="status">{toast.message}</div>
{/if}

<style>
	.shell {
		display: flex;
		justify-content: center;
		min-height: 100dvh;
	}
	main {
		width: 100%;
		max-width: var(--center);
		min-width: 0;
		padding-bottom: calc(var(--tabbar) + env(safe-area-inset-bottom) + var(--s-lg));
	}
	.playing main {
		padding-bottom: calc(var(--tabbar) + var(--mini) + env(safe-area-inset-bottom) + var(--s-2xl));
	}
	.toast {
		position: fixed;
		left: 50%;
		bottom: calc(var(--tabbar) + var(--mini) + env(safe-area-inset-bottom) + var(--s-xl));
		transform: translateX(-50%);
		z-index: 30;
		max-width: calc(100% - 2 * var(--s-lg));
		padding: var(--s-sm) var(--s-lg);
		border-radius: var(--r-full);
		background: var(--c-1000);
		color: var(--c-0);
		font-size: var(--t-sm);
		font-weight: 600;
		box-shadow: 0 6px 20px rgb(0 0 0 / 0.2);
	}
	@media (min-width: 800px) {
		main {
			border-left: 1px solid var(--c-50);
			border-right: 1px solid var(--c-50);
			padding-bottom: var(--s-4xl);
		}
		.playing main {
			padding-bottom: calc(72px + var(--s-4xl));
		}
		.shell {
			/* keep the column centered: a spacer as wide as the rail on the right */
			padding-right: var(--rail);
		}
		.toast {
			bottom: calc(72px + var(--s-xl));
		}
	}
	@media (min-width: 800px) and (max-width: 1099px) {
		.shell {
			padding-right: 0;
		}
	}
</style>
