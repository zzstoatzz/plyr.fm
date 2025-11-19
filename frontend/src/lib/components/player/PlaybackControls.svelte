<script lang="ts">
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';

	let formattedCurrentTime = $derived(formatTime(player.currentTime));
	let formattedDuration = $derived(formatTime(player.duration));
	let progressPercent = $derived.by(() => {
		if (!player.duration || player.duration === 0) return 0;
		return (player.currentTime / player.duration) * 100;
	});

	let volumeState = $derived.by(() => {
		if (player.volume === 0) return 'muted';
		if (player.volume >= 0.99) return 'max';
		return 'normal';
	});

	function handlePrevious() {
		const RESTART_THRESHOLD = 1;

		if (player.currentTime > RESTART_THRESHOLD) {
			player.currentTime = 0;
			if (player.paused) {
				player.paused = false;
			}
		} else if (queue.hasPrevious) {
			queue.previous();
		} else {
			player.currentTime = 0;
			if (player.paused) {
				player.paused = false;
			}
		}
	}

	function formatTime(seconds: number): string {
		if (!isFinite(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}
</script>

<div class="player-controls">
	<button class="control-btn" onclick={handlePrevious} title="previous track / restart">
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
			<path d="M6 4h2v16H6V4zm12 0l-10 8 10 8V4z" />
		</svg>
	</button>

	<button
		class="control-btn play-pause"
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

	<button
		class="control-btn"
		class:disabled={!queue.hasNext}
		onclick={() => queue.next()}
		title="next track"
		disabled={!queue.hasNext}
	>
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
			<path d="M16 4h2v16h-2V4zM6 4l10 8-10 8V4z"></path>
		</svg>
	</button>

	<div class="playback-options">
		<button
			class="option-btn"
			class:active={queue.shuffle}
			onclick={() => queue.toggleShuffle()}
			title={queue.shuffle ? 'disable shuffle' : 'enable shuffle'}
		>
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="16 3 21 3 21 8"></polyline>
				<line x1="4" y1="20" x2="21" y2="3"></line>
				<polyline points="21 16 21 21 16 21"></polyline>
				<line x1="15" y1="15" x2="21" y2="21"></line>
				<line x1="4" y1="4" x2="9" y2="9"></line>
			</svg>
		</button>
	</div>

	<div class="time-control">
		<span class="time">{formattedCurrentTime}</span>
		<input
			type="range"
			class="seek-bar"
			min="0"
			max={player.duration || 0}
			bind:value={player.currentTime}
			style="--progress: {progressPercent}%"
		/>
		<span class="time">{formattedDuration}</span>
	</div>

	<div class="volume-control">
		<div class="volume-icon" class:muted={volumeState === 'muted'}>
			{#if volumeState === 'muted'}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
					<line x1="23" y1="9" x2="17" y2="15"></line>
					<line x1="17" y1="9" x2="23" y2="15"></line>
				</svg>
			{:else if volumeState === 'max'}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="max-volume">
					<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
					<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
					<path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
				</svg>
			{:else}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
					<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
				</svg>
			{/if}
		</div>
		<input
			type="range"
			class="volume-bar"
			class:muted={volumeState === 'muted'}
			class:max={volumeState === 'max'}
			min="0"
			max="1"
			step="0.01"
			bind:value={player.volume}
		/>
	</div>
</div>

<style>
	.player-controls {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 1rem;
		min-width: 0;
		width: 100%;
	}

	.control-btn {
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		padding: 0.6rem;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		border-radius: 50%;
	}

	.control-btn svg {
		width: 24px;
		height: 24px;
	}

	.control-btn:hover {
		color: var(--accent);
		background: rgba(106, 159, 255, 0.1);
	}

	.control-btn.play-pause:active {
		transform: scale(0.95);
	}

	.control-btn.disabled {
		opacity: 0.4;
		pointer-events: none;
	}

	.playback-options {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.option-btn {
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		cursor: pointer;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		transition: all 0.2s;
		position: relative;
	}

	.option-btn svg {
		width: 20px;
		height: 20px;
	}

	.option-btn:hover {
		color: var(--text-primary);
		border-color: var(--accent);
	}

	.option-btn.active {
		color: var(--accent);
		border-color: var(--accent);
	}

	.time-control {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.time {
		font-size: 0.85rem;
		color: #909090;
		min-width: 45px;
		font-variant-numeric: tabular-nums;
	}

	.seek-bar,
	.volume-bar {
		flex: 1;
	}

	.volume-control {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #909090;
		min-width: 140px;
		position: relative;
	}

	.volume-icon {
		display: flex;
		align-items: center;
		transition: all 0.3s;
	}

	.volume-icon.muted {
		color: #ff6b6b;
		animation: shake 0.5s ease-in-out;
	}

	.volume-icon .max-volume {
		color: var(--accent);
		animation: pulse 0.5s ease-in-out;
	}

	@keyframes shake {
		0%, 100% { transform: translateX(0); }
		25% { transform: translateX(-3px); }
		75% { transform: translateX(3px); }
	}

	@keyframes pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.15); }
	}

	input[type="range"] {
		-webkit-appearance: none;
		appearance: none;
		background: transparent;
		cursor: pointer;
	}

	input[type="range"]::-webkit-slider-runnable-track {
		background: linear-gradient(
			to right,
			color-mix(in srgb, var(--accent) 60%, transparent) 0%,
			color-mix(in srgb, var(--accent) 60%, transparent) var(--progress, 0%),
			color-mix(in srgb, var(--accent) 20%, transparent) var(--progress, 0%),
			color-mix(in srgb, var(--accent) 20%, transparent) 100%
		);
		height: 4px;
		border-radius: 2px;
	}

	input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		background: var(--accent);
		height: 14px;
		width: 14px;
		border-radius: 50%;
		margin-top: -5px;
		transition: all 0.2s;
		box-shadow: 0 0 0 8px transparent;
	}

	input[type="range"]::-webkit-slider-thumb:hover {
		background: var(--accent-hover);
		transform: scale(1.2);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent);
	}

	input[type="range"].muted::-webkit-slider-thumb {
		background: #ff6b6b;
	}

	input[type="range"].max::-webkit-slider-thumb {
		background: var(--accent);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	input[type="range"]::-moz-range-track {
		background: color-mix(in srgb, var(--accent) 20%, transparent);
		height: 4px;
		border-radius: 2px;
	}

	input[type="range"]::-moz-range-progress {
		background: color-mix(in srgb, var(--accent) 60%, transparent);
		height: 4px;
		border-radius: 2px;
	}

	input[type="range"]::-moz-range-thumb {
		background: var(--accent);
		height: 14px;
		width: 14px;
		border-radius: 50%;
		border: none;
		transition: all 0.2s;
		box-shadow: 0 0 0 8px transparent;
	}

	input[type="range"]::-moz-range-thumb:hover {
		background: var(--accent-hover);
		transform: scale(1.2);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent);
	}

	input[type="range"].muted::-moz-range-thumb {
		background: #ff6b6b;
	}

	input[type="range"].max::-moz-range-thumb {
		background: var(--accent);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	@media (max-width: 768px) {
		.player-controls {
			display: contents;
		}

		.control-btn {
			grid-row: 1;
			padding: 0.5rem;
		}

		.control-btn:nth-of-type(1) {
			grid-column: 4;
		}

		.control-btn.play-pause {
			grid-column: 5;
		}

		.control-btn:nth-of-type(3) {
			grid-column: 6;
		}

		.control-btn svg {
			width: 28px;
			height: 28px;
		}

		.control-btn.play-pause svg {
			width: 32px;
			height: 32px;
		}

		.playback-options {
			grid-row: 2;
			grid-column: 1;
		}

		.option-btn {
			width: 36px;
			height: 36px;
		}

		.option-btn svg {
			width: 18px;
			height: 18px;
		}

		.time-control {
			grid-row: 2;
			grid-column: 2 / 7;
		}

		.time {
			font-size: 0.75rem;
			min-width: 38px;
		}

		.volume-control {
			display: none;
		}
	}
</style>
