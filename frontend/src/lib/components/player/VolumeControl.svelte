<script lang="ts">
	import { player } from '$lib/player.svelte';

	let volumeState = $derived.by(() => {
		if (player.volume === 0) return 'muted';
		if (player.volume >= 0.99) return 'max';
		return 'normal';
	});
</script>

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
		aria-label="volume"
		bind:value={player.volume}
	/>
</div>

<style>
	.volume-control {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-tertiary);
		min-width: 140px;
		position: relative;
	}

	.volume-icon {
		display: flex;
		align-items: center;
		transition: all 0.3s;
	}

	.volume-icon.muted {
		color: var(--error);
		animation: shake 0.5s ease-in-out;
	}

	.volume-icon .max-volume {
		color: var(--accent);
		animation: pulse 0.5s ease-in-out;
	}

	.volume-bar {
		flex: 1;
		-webkit-appearance: none;
		appearance: none;
		height: 4px;
		background: var(--bg-hover);
		border-radius: var(--radius-sm);
		outline: none;
		cursor: pointer;
	}

	.volume-bar::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
	}

	.volume-bar::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--accent);
		cursor: pointer;
		border: none;
	}


	.volume-bar.muted::-webkit-slider-thumb {
		background: var(--error);
	}

	.volume-bar.max::-webkit-slider-thumb {
		background: var(--accent);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.volume-bar.muted::-moz-range-thumb {
		background: var(--error);
	}

	.volume-bar.max::-moz-range-thumb {
		background: var(--accent);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(-2px);
		}
		75% {
			transform: translateX(2px);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.15);
		}
	}

	@media (max-width: 768px) {
		.volume-control {
			display: none;
		}
	}
</style>
