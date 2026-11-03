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
			<a href="/upload">upload</a>
			<a href="/profile">profile</a>
			<button class="link viewer" onclick={() => auth.logout()} title="sign out">
				{#if auth.avatar}<img src={auth.avatar} alt="" width="20" height="20" />{/if}
				<span>{auth.displayName ?? auth.handle ?? 'sign out'}</span>
			</button>
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
		position: sticky;
		top: 0;
		z-index: 1;
		background: Canvas;
	}
	.tag {
		padding: 0 0.3rem;
		vertical-align: middle;
	}
	form {
		flex: 1;
		min-width: 0;
	}
	@media (max-width: 560px) {
	header {
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
	}
	header form {
		order: 3;
		flex-basis: 100%;
	}
	header input {
		max-width: none;
	}
	nav {
		margin-left: auto;
	}
	}
	input {
		box-sizing: border-box;
		width: 100%;
		max-width: 320px;
		padding: 0.4rem 0.6rem;
	}
	nav {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}
	nav a,
		.link {
		cursor: pointer;
	}
	.viewer {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.viewer img {
		object-fit: cover;
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
		background: Canvas;
	}
	.now {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.controls button {
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
