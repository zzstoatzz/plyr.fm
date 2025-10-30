<script lang="ts">
	import { onMount } from 'svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import Header from '$lib/components/Header.svelte';
	import type { Track, User } from '$lib/types';
	import { API_URL } from '$lib/config';

	let tracks = $state<Track[]>([]);
	let currentTrack = $state<Track | null>(null);
	let audioElement = $state<HTMLAudioElement | undefined>(undefined);
	let user = $state<User | null>(null);

	// player state - using Svelte's built-in bindings
	let paused = $state(true);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(0.7);

	// derived values
	let hasTracks = $derived(tracks.length > 0);
	let isAuthenticated = $derived(user !== null);
	let formattedCurrentTime = $derived(formatTime(currentTime));
	let formattedDuration = $derived(formatTime(duration));

	onMount(async () => {
		// check authentication
		try {
			const authResponse = await fetch('`${API_URL}`/auth/me', {
				credentials: 'include'
			});
			if (authResponse.ok) {
				user = await authResponse.json();
			}
		} catch (e) {
			// not authenticated, that's fine
		}

		// load tracks
		const response = await fetch('`${API_URL}`/tracks/');
		const data = await response.json();
		tracks = data.tracks;
	});

	// Use $effect to reactively handle track changes only
	let previousTrackId: number | null = null;
	$effect(() => {
		if (!currentTrack || !audioElement) return;

		// Only load new track if it actually changed
		if (currentTrack.id !== previousTrackId) {
			previousTrackId = currentTrack.id;
			audioElement.src = `${API_URL}/audio/${currentTrack.file_id}`;
			audioElement.load();

			if (!paused) {
				audioElement.play().catch(err => {
					console.error('playback failed:', err);
					paused = true;
				});
			}
		}
	});

	function playTrack(track: Track) {
		if (currentTrack?.id === track.id) {
			// toggle play/pause on same track
			paused = !paused;
		} else {
			// switch tracks
			currentTrack = track;
			paused = false;
		}
	}

	function formatTime(seconds: number): string {
		if (!seconds || isNaN(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	async function logout() {
		await fetch('`${API_URL}`/auth/logout', {
			method: 'POST',
			credentials: 'include'
		});
		user = null;
	}
</script>

<Header {user} onLogout={logout} />

<main>

	<section class="tracks">
		<h2>latest tracks</h2>
		{#if !hasTracks}
			<p class="empty">no tracks yet</p>
		{:else}
			<div class="track-list">
				{#each tracks as track}
					<TrackItem
						{track}
						isPlaying={currentTrack?.id === track.id}
						onPlay={playTrack}
					/>
				{/each}
			</div>
		{/if}
	</section>

	{#if currentTrack}
		<div class="player">
			<audio
				bind:this={audioElement}
				bind:paused
				bind:currentTime
				bind:duration
				bind:volume
				onended={() => {
					currentTime = 0;
					paused = true;
				}}
			></audio>

			<div class="player-content">
				<div class="player-info">
					<div class="player-title">{currentTrack.title}</div>
					<div class="player-artist">{currentTrack.artist}</div>
				</div>

				<div class="player-controls">
					<button class="control-btn" onclick={() => paused = !paused} title={paused ? 'Play' : 'Pause'}>
						{#if !paused}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
								<rect x="6" y="4" width="4" height="16" rx="1"></rect>
								<rect x="14" y="4" width="4" height="16" rx="1"></rect>
							</svg>
						{:else}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
								<path d="M8 5v14l11-7z"></path>
							</svg>
						{/if}
					</button>

					<div class="time-control">
						<span class="time">{formattedCurrentTime}</span>
						<input
							type="range"
							class="seek-bar"
							min="0"
							max={duration || 0}
							bind:value={currentTime}
						/>
						<span class="time">{formattedDuration}</span>
					</div>

					<div class="volume-control">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
							<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
							<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
						</svg>
						<input
							type="range"
							class="volume-bar"
							min="0"
							max="1"
							step="0.01"
							bind:value={volume}
						/>
					</div>
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Consolas', monospace;
		background: #0a0a0a;
		color: #e0e0e0;
		-webkit-font-smoothing: antialiased;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem 120px;
	}

	.tracks h2 {
		font-size: 1.5rem;
		margin-bottom: 1.5rem;
		color: #e8e8e8;
	}

	.empty {
		color: #808080;
		padding: 2rem;
		text-align: center;
	}

	.track-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.player {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: #1a1a1a;
		border-top: 1px solid #2a2a2a;
		padding: 1rem;
		z-index: 100;
	}

	.player-content {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 2rem;
	}

	.player-info {
		flex: 0 0 200px;
		min-width: 0;
	}

	.player-title {
		font-weight: 600;
		font-size: 0.95rem;
		margin-bottom: 0.25rem;
		color: #e8e8e8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.player-artist {
		color: #b0b0b0;
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.player-controls {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.control-btn {
		background: transparent;
		border: none;
		color: #fff;
		cursor: pointer;
		padding: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		border-radius: 50%;
	}

	.control-btn:hover {
		background: rgba(58, 125, 255, 0.1);
		color: #3a7dff;
	}

	.time-control {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.time {
		font-size: 0.8rem;
		color: #888;
		font-variant-numeric: tabular-nums;
		min-width: 40px;
	}

	.seek-bar {
		flex: 1;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: #2a2a2a;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.seek-bar::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		background: #3a7dff;
		border-radius: 50%;
		cursor: pointer;
		transition: all 0.2s;
	}

	.seek-bar::-webkit-slider-thumb:hover {
		background: #5a8fff;
		transform: scale(1.2);
	}

	.seek-bar::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: #3a7dff;
		border-radius: 50%;
		border: none;
		cursor: pointer;
		transition: all 0.2s;
	}

	.seek-bar::-moz-range-thumb:hover {
		background: #5a8fff;
		transform: scale(1.2);
	}

	.volume-control {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 0 0 120px;
	}

	.volume-control svg {
		flex-shrink: 0;
		color: #888;
	}

	.volume-bar {
		flex: 1;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: #2a2a2a;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.volume-bar::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 10px;
		height: 10px;
		background: #888;
		border-radius: 50%;
		cursor: pointer;
		transition: all 0.2s;
	}

	.volume-bar::-webkit-slider-thumb:hover {
		background: #aaa;
		transform: scale(1.2);
	}

	.volume-bar::-moz-range-thumb {
		width: 10px;
		height: 10px;
		background: #888;
		border-radius: 50%;
		border: none;
		cursor: pointer;
		transition: all 0.2s;
	}

	.volume-bar::-moz-range-thumb:hover {
		background: #aaa;
		transform: scale(1.2);
	}
</style>
