<script lang="ts">
	import { onMount } from 'svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';

	// radio mode: live stream — no prev/next or scrubbing, just play/pause + volume
	let { radioMode = false }: { radioMode?: boolean } = $props();

	let seekValue = $state(0);
	let isScrubbing = $state(false);
	let rafId: number | null = null;
	let lastTrackId: number | null = null;

	let formattedCurrentTime = $derived(formatTime(seekValue));
	let formattedDuration = $derived(formatTime(player.duration));
	let progressPercent = $derived.by(() => {
		if (!player.duration || player.duration === 0) return 0;
		return (seekValue / player.duration) * 100;
	});

	let volumeState = $derived.by(() => {
		if (player.volume === 0) return 'muted';
		if (player.volume >= 0.99) return 'max';
		return 'normal';
	});

	function animateSeek() {
		if (typeof window === 'undefined') return;
		if (!isScrubbing) {
			const liveTime = player.audioElement?.currentTime;
			if (liveTime !== undefined && !Number.isNaN(liveTime)) {
				seekValue = liveTime;
			} else {
				seekValue = player.currentTime;
			}
		}
		rafId = window.requestAnimationFrame(animateSeek);
	}

	onMount(() => {
		seekValue = player.currentTime || 0;
		if (typeof window !== 'undefined') {
			rafId = window.requestAnimationFrame(animateSeek);
		}
		return () => {
			if (typeof window !== 'undefined' && rafId !== null) {
				window.cancelAnimationFrame(rafId);
			}
		};
	});

	$effect(() => {
		const trackId = player.currentTrack?.id ?? null;
		if (trackId !== lastTrackId) {
			lastTrackId = trackId;
			seekValue = player.currentTime || 0;
		}
	});

	function handlePrevious() {
		const RESTART_THRESHOLD = 1;

		if (player.currentTime > RESTART_THRESHOLD) {
			queue.seek(0);
			seekValue = 0;
			queue.play();
		} else if (queue.hasPrevious) {
			queue.previous();
		} else {
			queue.seek(0);
			seekValue = 0;
			queue.play();
		}
	}

	function handleSeekInput(event: Event) {
		isScrubbing = true;
		const value = Number((event.currentTarget as HTMLInputElement).value);
		seekValue = value;
	}

	function commitSeek(value: number) {
		queue.seek(Math.round(value * 1000));
		seekValue = value;
	}

	function handleSeekChange(event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		commitSeek(value);
	}

	function handleSeekPointerUp(event: PointerEvent) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		commitSeek(value);
		isScrubbing = false;
	}

	function handleSeekPointerCancel(event?: PointerEvent) {
		if (event) {
			const value = Number((event.currentTarget as HTMLInputElement).value);
			commitSeek(value);
		}
		isScrubbing = false;
	}

	function formatTime(seconds: number): string {
		if (!isFinite(seconds)) return '0:00';
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}
</script>

<div class="player-controls" class:radio-mode={radioMode}>
	{#if radioMode}
		<!-- live stream: a static ∞ marker holds play/pause in its normal slot
		     instead of letting it jump left where the prev button used to be -->
		<button class="control-btn infinity" disabled aria-hidden="true" title="continuous — radio doesn't skip">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
				<path d="M18.6 6.62c-1.44 0-2.8.56-3.77 1.53L7.8 14.39c-.64.64-1.49.99-2.4.99-1.87 0-3.39-1.51-3.39-3.38S3.53 8.62 5.4 8.62c.91 0 1.76.35 2.44 1.03l1.13 1 1.51-1.34L9.22 8.2C8.2 7.18 6.84 6.62 5.4 6.62 2.42 6.62 0 9.04 0 12s2.42 5.38 5.4 5.38c1.44 0 2.8-.56 3.77-1.53l7.43-6.57c.64-.64 1.49-.99 2.4-.99 1.87 0 3.39 1.51 3.39 3.38s-1.52 3.38-3.39 3.38c-.9 0-1.76-.35-2.44-1.03l-1.14-1.01-1.51 1.34 1.27 1.12c1.02 1.01 2.37 1.57 3.82 1.57 2.98 0 5.4-2.42 5.4-5.38s-2.42-5.37-5.4-5.37z" />
			</svg>
		</button>
	{:else}
		<button class="control-btn" onclick={handlePrevious} title="previous track / restart">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
				<path d="M6 4h2v16H6V4zm12 0l-10 8 10 8V4z" />
			</svg>
		</button>
	{/if}

	<button
		class="control-btn play-pause"
		onclick={() => queue.togglePlayPause()}
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

	{#if !radioMode}
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

		<button
			class="control-btn"
			class:active={queue.shuffle}
			onclick={() => queue.toggleShuffle()}
			title={queue.shuffle ? 'disable shuffle' : 'enable shuffle'}
		>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="16 3 21 3 21 8"></polyline>
				<line x1="4" y1="20" x2="21" y2="3"></line>
				<polyline points="21 16 21 21 16 21"></polyline>
				<line x1="15" y1="15" x2="21" y2="21"></line>
				<line x1="4" y1="4" x2="9" y2="9"></line>
			</svg>
		</button>

		<button
			class="control-btn"
			class:active={queue.repeatMode !== 'none'}
			onclick={() => queue.toggleRepeatMode()}
			title={queue.repeatMode === 'none' ? 'enable repeat' : queue.repeatMode === 'all' ? 'repeat all' : 'repeat one'}
		>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="17 1 21 5 17 9"></polyline>
				<path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
				<polyline points="7 23 3 19 7 15"></polyline>
				<path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
				{#if queue.repeatMode === 'one'}
					<text x="12" y="17" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" stroke="none">1</text>
				{/if}
			</svg>
		</button>

		<div class="time-control">
			<span class="time">{formattedCurrentTime}</span>
			<input
				type="range"
				class="seek-bar"
				min="0"
				max={player.duration || 0}
				step="0.01"
				value={seekValue}
				oninput={handleSeekInput}
				onchange={handleSeekChange}
				onpointerdown={() => (isScrubbing = true)}
				onpointerup={handleSeekPointerUp}
				onpointerleave={(event) => {
					if (isScrubbing) handleSeekPointerCancel(event);
				}}
				onpointercancel={handleSeekPointerCancel}
				style="--progress: {progressPercent}%"
			/>
			<span class="time">{formattedDuration}</span>
		</div>
	{:else}
		<span class="live-pill">live</span>
	{/if}

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

	/* radio: "live" fills the slot the scrubber would occupy, keeping play/pause
	   left and volume right — same control row, no scrubber/skip */
	.live-pill {
		flex: 1;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
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
		border-radius: var(--radius-full);
	}

	.control-btn svg {
		width: 24px;
		height: 24px;
	}

	.control-btn:hover {
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.control-btn.active {
		color: var(--accent);
	}

	.control-btn.play-pause:active {
		transform: scale(0.95);
	}

	.control-btn.disabled {
		opacity: 0.4;
		pointer-events: none;
	}

	/* radio: static, non-interactive marker that holds play/pause in place */
	.control-btn.infinity {
		color: var(--text-tertiary);
		opacity: 0.55;
		cursor: default;
	}

	.control-btn.infinity:hover {
		color: var(--text-tertiary);
		background: transparent;
	}

	.time-control {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.time {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
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
		border-radius: var(--radius-full);
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
		background: var(--error);
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
		border-radius: var(--radius-full);
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
		background: var(--error);
	}

	input[type="range"].max::-moz-range-thumb {
		background: var(--accent);
		box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	@media (max-width: 768px) {
		.player-controls {
			display: grid;
			grid-template-columns: repeat(5, auto);
			justify-content: center;
			align-items: center;
			gap: 0.25rem;
		}

		.control-btn {
			padding: 0.5rem;
		}

		.control-btn svg {
			width: 24px;
			height: 24px;
		}

		.control-btn.play-pause svg {
			width: 28px;
			height: 28px;
		}

		.time-control {
			grid-column: 1 / -1;
			grid-row: 2;
		}

		/* radio: "live" takes the scrubber's row instead of the control row */
		.live-pill {
			grid-row: 2;
			grid-column: 1 / -1;
			text-align: center;
		}

		.time {
			font-size: var(--text-xs);
			min-width: 38px;
		}

		.volume-control {
			display: none;
		}
	}
</style>
