<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/auth.svelte';
	import { player } from '$lib/player.svelte';
	import { goto } from '$app/navigation';
	import '../app.css';

	let { children } = $props();
	let audio = $state<HTMLAudioElement>();
	let q = $state('');

	onMount(() => {
		auth.restore();
	});

	$effect(() => {
		if (!audio) return;
		if (player.src && audio.src !== player.src) audio.src = player.src;
		if (player.playing) audio.play().catch(() => (player.playing = false));
		else audio.pause();
	});

	function search(e: SubmitEvent) {
		e.preventDefault();
		if (q.trim()) goto(`/search?q=${encodeURIComponent(q.trim())}`);
	}
</script>

<header>
	<a class="brand" href="/">plyr.fm <span class="tag">next</span></a>
	<form onsubmit={search}><input bind:value={q} placeholder="search" aria-label="search" /></form>
	<nav>
		<a href="/playlists">playlists</a>
		{#if auth.did}
			<a href="/liked">liked</a>
			<button class="link" onclick={() => auth.logout()}>{auth.handle ?? 'sign out'}</button>
		{:else if auth.ready}
			<a href="/login">sign in</a>
		{/if}
	</nav>
</header>

<main>{@render children()}</main>

{#if player.current}
	<footer class="player">
		<div class="now">
			<a href="/track/{player.current.id}">{player.current.metadata.title}</a>
			<span>{player.current.artist.profile.display_name || player.current.artist.profile.handle}</span>
			{#if player.error}<span class="error">{player.error}</span>{/if}
		</div>
		<div class="controls">
			<button onclick={() => player.prev()} aria-label="previous">⏮</button>
			<button onclick={() => (player.playing = !player.playing)} aria-label={player.playing ? 'pause' : 'play'}>
				{player.playing ? '⏸' : '▶'}
			</button>
			<button onclick={() => player.next()} aria-label="next">⏭</button>
		</div>
		<audio bind:this={audio} controls onended={() => player.next()} onpause={() => (player.playing = false)} onplay={() => (player.playing = true)}></audio>
	</footer>
{/if}

<style>
	header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--surface-3);
		position: sticky;
		top: 0;
		background: var(--bg);
		z-index: 1;
	}
	.brand {
		font-weight: 800;
		color: var(--text);
		text-decoration: none;
	}
	.tag {
		font-size: 0.7rem;
		color: var(--accent);
		border: 1px solid var(--accent);
		border-radius: 4px;
		padding: 0 0.3rem;
		vertical-align: middle;
	}
	form {
		flex: 1;
	}
	input {
		width: 100%;
		max-width: 320px;
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		border: 1px solid var(--surface-3);
		background: var(--surface-2);
		color: var(--text);
	}
	nav {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}
	nav a,
	.link {
		color: var(--muted);
		text-decoration: none;
		background: none;
		border: 0;
		cursor: pointer;
		font: inherit;
	}
	main {
		max-width: 880px;
		margin: 0 auto;
		padding: 1rem 1rem 7rem;
	}
	.player {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 1rem;
		background: var(--surface-2);
		border-top: 1px solid var(--surface-3);
	}
	.now {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.now a {
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	.now span {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.now .error {
		color: var(--accent);
	}
	.controls button {
		background: none;
		border: 0;
		color: var(--text);
		font-size: 1.2rem;
		cursor: pointer;
	}
	audio {
		width: 100%;
	}
	@media (max-width: 600px) {
		.player {
			grid-template-columns: 1fr auto;
		}
		audio {
			display: none;
		}
	}
</style>
