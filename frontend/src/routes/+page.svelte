<script lang="ts">
	import { onMount } from 'svelte';

	interface Track {
		id: number;
		title: string;
		artist: string;
		album?: string;
		file_id: string;
		file_type: string;
		artist_handle: string;
	}

	interface User {
		did: string;
		handle: string;
	}

	let tracks: Track[] = [];
	let currentTrack: Track | null = null;
	let audioElement: HTMLAudioElement;
	let user: User | null = null;

	onMount(async () => {
		// check authentication
		try {
			const authResponse = await fetch('http://localhost:8000/auth/me', {
				credentials: 'include'
			});
			if (authResponse.ok) {
				user = await authResponse.json();
			}
		} catch (e) {
			// not authenticated, that's fine
		}

		// load tracks
		const response = await fetch('http://localhost:8000/tracks/');
		const data = await response.json();
		tracks = data.tracks;
	});

	function playTrack(track: Track) {
		currentTrack = track;
		if (audioElement) {
			audioElement.src = `http://localhost:8000/audio/${track.file_id}`;
			audioElement.play();
		}
	}

	async function logout() {
		await fetch('http://localhost:8000/auth/logout', {
			method: 'POST',
			credentials: 'include'
		});
		user = null;
	}
</script>

<main>
	<header>
		<div class="header-top">
			<div>
				<h1>relay</h1>
				<p>decentralized music on ATProto</p>
			</div>
			<div class="auth-section">
				{#if user}
					<span class="user-info">@{user.handle}</span>
					<button onclick={logout} class="logout-btn">logout</button>
				{:else}
					<a href="/login" class="login-link">login</a>
				{/if}
			</div>
		</div>
		{#if user}
			<a href="/portal">artist portal →</a>
		{/if}
	</header>

	<section class="tracks">
		<h2>latest tracks</h2>
		{#if tracks.length === 0}
			<p class="empty">no tracks yet</p>
		{:else}
			<div class="track-list">
				{#each tracks as track}
					<button
						class="track"
						class:playing={currentTrack?.id === track.id}
						onclick={() => playTrack(track)}
					>
						<div class="track-info">
							<div class="track-title">{track.title}</div>
							<div class="track-artist">
								{track.artist}
								{#if track.album}
									<span class="album">- {track.album}</span>
								{/if}
							</div>
							<div class="track-meta">@{track.artist_handle}</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</section>

	{#if currentTrack}
		<div class="player">
			<div class="now-playing">
				<strong>{currentTrack.title}</strong> by {currentTrack.artist}
			</div>
			<audio bind:this={audioElement} controls></audio>
		</div>
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		background: #0a0a0a;
		color: #fff;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem 1rem 120px;
	}

	header {
		margin-bottom: 3rem;
	}

	.header-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
	}

	h1 {
		font-size: 2.5rem;
		margin: 0 0 0.5rem;
	}

	header p {
		color: #888;
		margin: 0 0 1rem;
	}

	.auth-section {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.user-info {
		color: #aaa;
		font-size: 0.9rem;
	}

	.logout-btn {
		background: transparent;
		border: 1px solid #444;
		color: #aaa;
		padding: 0.4rem 0.8rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.9rem;
		transition: all 0.2s;
	}

	.logout-btn:hover {
		border-color: #666;
		color: #fff;
	}

	.login-link {
		color: #3a7dff;
		text-decoration: none;
		font-size: 0.9rem;
		padding: 0.4rem 0.8rem;
		border: 1px solid #3a7dff;
		border-radius: 4px;
		transition: all 0.2s;
	}

	.login-link:hover {
		background: #3a7dff;
		color: white;
	}

	header > a {
		color: #3a7dff;
		text-decoration: none;
		font-size: 0.9rem;
	}

	header > a:hover {
		text-decoration: underline;
	}

	.tracks h2 {
		font-size: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.empty {
		color: #666;
		padding: 2rem;
		text-align: center;
	}

	.track-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.track {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-left: 3px solid transparent;
		padding: 1rem;
		cursor: pointer;
		text-align: left;
		transition: all 0.2s;
		width: 100%;
	}

	.track:hover {
		background: #222;
		border-left-color: #3a7dff;
	}

	.track.playing {
		background: #1a2332;
		border-left-color: #3a7dff;
	}

	.track-title {
		font-weight: 600;
		font-size: 1.1rem;
		margin-bottom: 0.25rem;
	}

	.track-artist {
		color: #aaa;
		margin-bottom: 0.25rem;
	}

	.album {
		color: #888;
	}

	.track-meta {
		font-size: 0.85rem;
		color: #666;
	}

	.player {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: #1a1a1a;
		border-top: 1px solid #2a2a2a;
		padding: 1rem;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.now-playing {
		flex: 1;
		min-width: 0;
	}

	.now-playing strong {
		color: #fff;
	}

	audio {
		flex: 1;
		max-width: 400px;
	}
</style>
