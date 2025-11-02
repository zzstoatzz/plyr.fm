<script lang="ts">
	import { player } from '$lib/player.svelte';
	import { onMount } from 'svelte';

	let formattedCurrentTime = $derived(formatTime(player.currentTime));
	let formattedDuration = $derived(formatTime(player.duration));

	function formatTime(seconds: number): string {
		if (!isFinite(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	// track play count when threshold is reached
	$effect(() => {
		player.incrementPlayCount();
	});

	onMount(() => {
		// restore volume from localStorage if available
		const savedVolume = localStorage.getItem('player_volume');
		if (savedVolume) {
			player.volume = parseFloat(savedVolume);
		}
	});

	// save volume to localStorage when it changes
	$effect(() => {
		localStorage.setItem('player_volume', player.volume.toString());
	});
</script>

{#if player.currentTrack}
	<div class="player">
		<audio
			bind:this={player.audioElement}
			bind:paused={player.paused}
			bind:currentTime={player.currentTime}
			bind:duration={player.duration}
			bind:volume={player.volume}
			onended={() => player.reset()}
		></audio>

		<div class="player-content">
			<div class="player-info">
				<div class="player-title" class:scrolling={player.currentTrack.title.length > 30}>
					<span>{player.currentTrack.title}</span>
				</div>
				<a href="/@{player.currentTrack.artist_handle}" class="player-artist-link">
					{player.currentTrack.artist}
				</a>
			</div>

			<div class="player-controls">
				<button
					class="control-btn"
					onclick={() => player.togglePlayPause()}
					title={player.paused ? 'play' : 'pause'}
				>
					{#if !player.paused}
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
						max={player.duration || 0}
						bind:value={player.currentTime}
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
						bind:value={player.volume}
					/>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.player {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: #1a1a1a;
		border-top: 1px solid #333;
		padding: 1rem 2rem;
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
		min-width: 200px;
		max-width: 300px;
		overflow: hidden;
	}

	.player-title {
		font-weight: 600;
		color: #e8e8e8;
		margin-bottom: 0.25rem;
		white-space: nowrap;
		overflow: hidden;
	}

	.player-title.scrolling {
		overflow: visible;
	}

	.player-title.scrolling span {
		display: inline-block;
		padding-right: 2rem;
		animation: scroll-text 10s linear infinite;
	}

	@keyframes scroll-text {
		0% {
			transform: translateX(0);
		}
		100% {
			transform: translateX(-100%);
		}
	}

	.player-artist-link {
		color: #909090;
		font-size: 0.9rem;
		text-decoration: none;
		display: block;
		transition: color 0.2s;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.player-artist-link:hover {
		color: #6a9fff;
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
		color: #e8e8e8;
		cursor: pointer;
		padding: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.control-btn:hover {
		color: #6a9fff;
		transform: scale(1.1);
	}

	.time-control {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.time {
		font-size: 0.85rem;
		color: #909090;
		min-width: 45px;
	}

	.seek-bar,
	.volume-bar {
		flex: 1;
	}

	.volume-control {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: #909090;
		min-width: 150px;
	}

	input[type="range"] {
		-webkit-appearance: none;
		appearance: none;
		background: transparent;
		cursor: pointer;
	}

	input[type="range"]::-webkit-slider-track {
		background: #333;
		height: 4px;
		border-radius: 2px;
	}

	input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		background: #6a9fff;
		height: 14px;
		width: 14px;
		border-radius: 50%;
		margin-top: -5px;
		transition: all 0.2s;
	}

	input[type="range"]::-webkit-slider-thumb:hover {
		background: #8ab3ff;
		transform: scale(1.2);
	}

	input[type="range"]::-moz-range-track {
		background: #333;
		height: 4px;
		border-radius: 2px;
	}

	input[type="range"]::-moz-range-thumb {
		background: #6a9fff;
		height: 14px;
		width: 14px;
		border-radius: 50%;
		border: none;
		transition: all 0.2s;
	}

	input[type="range"]::-moz-range-thumb:hover {
		background: #8ab3ff;
		transform: scale(1.2);
	}

	@media (max-width: 768px) {
		.player {
			padding: 1rem;
		}

		.player-content {
			flex-direction: column;
			gap: 1rem;
		}

		.player-info {
			min-width: 100%;
			max-width: 100%;
			text-align: center;
		}

		.player-controls {
			width: 100%;
			flex-direction: column;
			gap: 1rem;
		}

		.time-control {
			width: 100%;
		}

		/* hide volume control on mobile - use device volume */
		.volume-control {
			display: none;
		}
	}
</style>
