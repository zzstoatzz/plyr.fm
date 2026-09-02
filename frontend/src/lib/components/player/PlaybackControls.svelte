<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { auth } from '$lib/auth.svelte';
	import { SKIP_BUTTONS_FLAG } from '$lib/config';
	import { skipStepSeconds } from '$lib/skip-step';

	import VolumeControl from './VolumeControl.svelte';

	// radio mode: live stream — no prev/next or scrubbing, just play/pause + volume.
	// stacked: the transport on one row and the scrubber on its own full-width
	// row beneath it, with volume owned by the footer's right cluster
	let { radioMode = false, stacked = false }: { radioMode?: boolean; stacked?: boolean } = $props();

	const skipButtons = $derived(auth.user?.enabled_flags?.includes(SKIP_BUTTONS_FLAG) ?? false);
	const skipStep = $derived(skipStepSeconds(player.duration));

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

	function animateSeek() {
		if (!browser) return;
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
		if (browser) {
			rafId = window.requestAnimationFrame(animateSeek);
		}
		return () => {
			if (browser && rafId !== null) {
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

	type SliderEvent<E extends Event> = E & { currentTarget: HTMLInputElement };

	function handleSeekInput(event: SliderEvent<Event>) {
		isScrubbing = true;
		const value = Number(event.currentTarget.value);
		seekValue = value;
	}

	function commitSeek(value: number) {
		queue.seek(Math.round(value * 1000));
		seekValue = value;
	}

	function handleSeekChange(event: SliderEvent<Event>) {
		const value = Number(event.currentTarget.value);
		commitSeek(value);
	}

	function handleSeekPointerUp(event: SliderEvent<PointerEvent>) {
		const value = Number(event.currentTarget.value);
		commitSeek(value);
		isScrubbing = false;
	}

	function handleSeekPointerCancel(event?: SliderEvent<PointerEvent>) {
		if (event) {
			const value = Number(event.currentTarget.value);
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

<div class="player-controls" class:radio-mode={radioMode} class:stacked>
	<div class="transport">
	{#if stacked && !radioMode}
		<button
			class="control-btn shuffle"
			class:active={queue.shuffle}
			onclick={() => queue.toggleShuffle()}
			title={queue.shuffle ? 'shuffle on' : 'shuffle'}
			aria-pressed={queue.shuffle}
		>
			<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
			</svg>
		</button>
	{/if}
	{#if radioMode}
		<!-- live stream: a static ∞ marker holds play/pause in its normal slot
		     instead of letting it jump left where the prev button used to be -->
		<button class="control-btn infinity" disabled aria-hidden="true" title="continuous — radio doesn't skip">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
				<path d="M18.6 6.62c-1.44 0-2.8.56-3.77 1.53L7.8 14.39c-.64.64-1.49.99-2.4.99-1.87 0-3.39-1.51-3.39-3.38S3.53 8.62 5.4 8.62c.91 0 1.76.35 2.44 1.03l1.13 1 1.51-1.34L9.22 8.2C8.2 7.18 6.84 6.62 5.4 6.62 2.42 6.62 0 9.04 0 12s2.42 5.38 5.4 5.38c1.44 0 2.8-.56 3.77-1.53l7.43-6.57c.64-.64 1.49-.99 2.4-.99 1.87 0 3.39 1.51 3.39 3.38s-1.52 3.38-3.39 3.38c-.9 0-1.76-.35-2.44-1.03l-1.14-1.01-1.51 1.34 1.27 1.12c1.02 1.01 2.37 1.57 3.82 1.57 2.98 0 5.4-2.42 5.4-5.38s-2.42-5.37-5.4-5.37z" />
			</svg>
		</button>
	{:else}
		<button class="control-btn prev" onclick={handlePrevious} title="previous track / restart">
			{#if stacked}
				<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M6 5h2v14H6zM19 5.5v13a.7.7 0 0 1-1.1.6L9 12.6a.7.7 0 0 1 0-1.2l8.9-6.5A.7.7 0 0 1 19 5.5z" />
				</svg>
			{:else}
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
					<path d="M6 4h2v16H6V4zm12 0l-10 8 10 8V4z" />
				</svg>
			{/if}
		</button>
	{/if}

	{#if skipButtons && !radioMode}
		<button
			class="control-btn skip skip-back"
			onclick={() => queue.seekBy(-skipStep)}
			title="back {skipStep} seconds"
			aria-label="back {skipStep} seconds"
		>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<g>
					<path stroke-linecap="butt" d="M9.22 4.99A8.2 8.2 0 1 1 4.40 15.77" />
					<path fill="currentColor" stroke-width="0.6" d="M9.99 7.20L4.67 6.99L8.07 2.89Z" />
				</g>
				<text x="12" y="15.72" text-anchor="middle" font-size="8.4" font-weight="700" font-family="inherit" letter-spacing="-0.02em" fill="currentColor" stroke="none">{skipStep}</text>
			</svg>
		</button>
	{/if}

	<button
		class="control-btn play-pause"
		onclick={() => queue.togglePlayPause()}
		title={player.paused ? 'play' : 'pause'}
	>
		{#if stacked}
			{#if !player.paused}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
				</svg>
			{:else}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M8.5 5.6v12.8a.8.8 0 0 0 1.2.7l10.3-6.4a.8.8 0 0 0 0-1.4L9.7 4.9a.8.8 0 0 0-1.2.7z" />
				</svg>
			{/if}
		{:else if !player.paused}
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

	{#if skipButtons && !radioMode}
		<button
			class="control-btn skip skip-forward"
			onclick={() => queue.seekBy(skipStep)}
			title="forward {skipStep} seconds"
			aria-label="forward {skipStep} seconds"
		>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<g transform="translate(24 0) scale(-1 1)">
					<path stroke-linecap="butt" d="M9.22 4.99A8.2 8.2 0 1 1 4.40 15.77" />
					<path fill="currentColor" stroke-width="0.6" d="M9.99 7.20L4.67 6.99L8.07 2.89Z" />
				</g>
				<text x="12" y="15.72" text-anchor="middle" font-size="8.4" font-weight="700" font-family="inherit" letter-spacing="-0.02em" fill="currentColor" stroke="none">{skipStep}</text>
			</svg>
		</button>
	{/if}

	{#if !radioMode}
		<button
			class="control-btn next"
			class:disabled={!queue.hasNext}
			onclick={() => queue.next()}
			title="next track"
			disabled={!queue.hasNext}
		>
			{#if stacked}
				<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M18 5h-2v14h2zM5 5.5v13a.7.7 0 0 0 1.1.6L15 12.6a.7.7 0 0 0 0-1.2L6.1 4.9A.7.7 0 0 0 5 5.5z" />
				</svg>
			{:else}
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
					<path d="M16 4h2v16h-2V4zM6 4l10 8-10 8V4z"></path>
				</svg>
			{/if}
		</button>

		<button
			class="control-btn repeat"
			class:active={queue.repeatMode === 'one'}
			onclick={() => queue.toggleRepeatMode()}
			title={queue.repeatMode === 'one' ? 'stop repeating' : 'repeat this track'}
		>
			{#if stacked}
				<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M17.2 2.4 21 6.1l-3.8 3.7V7.2H7.6a2.1 2.1 0 0 0-2.1 2.1V12H3.3V9.3a4.3 4.3 0 0 1 4.3-4.3h9.6V2.4zM6.8 21.6 3 17.9l3.8-3.7v2.6h9.6a2.1 2.1 0 0 0 2.1-2.1V12h2.2v2.7a4.3 4.3 0 0 1-4.3 4.3H6.8v2.6z" />
					{#if queue.repeatMode === 'one'}
						<text x="12" y="14.6" text-anchor="middle" font-size="7" font-weight="700" font-family="inherit" fill="currentColor" stroke="none">1</text>
					{/if}
				</svg>
			{:else}
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="m17 2 4 4-4 4"></path>
				<path d="M3 11v-1a4 4 0 0 1 4-4h14"></path>
				<path d="m7 22-4-4 4-4"></path>
				<path d="M21 13v1a4 4 0 0 1-4 4H3"></path>
				{#if queue.repeatMode === 'one'}
					<path d="M11 10h1v4"></path>
				{/if}
			</svg>
			{/if}
		</button>
	{/if}
	</div>

	{#if !radioMode}
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

	{#if !stacked}
		<VolumeControl />
	{/if}
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

	/* secondary control: quieter than transport buttons */
	.control-btn.repeat svg {
		width: 18px;
		height: 18px;
	}

	.control-btn.play-pause:active {
		transform: scale(0.95);
	}

	/* the transport is a row only in the stage layout; elsewhere its children
	   sit in the parent flex/grid as before */
	.transport {
		display: contents;
	}

	/* stacked (the stage layout): the transport centred on one row that never
	   wraps, the scrubber on its own row taking the whole centre column */
	.player-controls.stacked {
		flex-direction: column;
		align-items: stretch;
		gap: 0.2rem;
	}

	.player-controls.stacked .transport {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		flex-wrap: nowrap;
	}

	.player-controls.stacked .control-btn {
		padding: 0.4rem;
		flex-shrink: 0;
	}

	.player-controls.stacked .control-btn svg {
		width: 22px;
		height: 22px;
	}

	.player-controls.stacked .control-btn.play-pause {
		width: 36px;
		height: 36px;
		padding: 0;
		background: var(--text-primary);
		color: var(--bg-primary);
	}

	.player-controls.stacked .control-btn.play-pause:hover {
		background: var(--text-primary);
		color: var(--bg-primary);
		transform: scale(1.05);
	}

	.player-controls.stacked .control-btn.play-pause svg {
		width: 18px;
		height: 18px;
	}

	.player-controls.stacked .time-control {
		width: 100%;
		max-width: none;
		margin: 0;
	}

	/* stage polish — the conventions modern players share:
	   transport idle secondary → primary on hover, active toggles carry a dot;
	   the scrubber is thin with a hidden thumb until hovered, primary fill that
	   turns accent under the pointer, a tall hit area; keyboard focus is a ring */
	.player-controls.stacked .control-btn {
		color: var(--text-secondary);
		transition:
			color 150ms cubic-bezier(0.2, 0, 0, 1),
			transform 150ms cubic-bezier(0.2, 0, 0, 1),
			background 150ms cubic-bezier(0.2, 0, 0, 1);
	}

	.player-controls.stacked .control-btn:hover {
		color: var(--text-primary);
		background: transparent;
	}

	.player-controls.stacked .control-btn:active {
		transform: scale(0.94);
	}

	.player-controls.stacked .control-btn.disabled,
	.player-controls.stacked .control-btn:disabled {
		opacity: 0.38;
		pointer-events: none;
	}

	.player-controls.stacked .control-btn.active {
		color: var(--accent);
		position: relative;
	}

	.player-controls.stacked .control-btn.active::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: 1px;
		width: 4px;
		height: 4px;
		border-radius: var(--radius-full);
		background: var(--accent);
		translate: -50% 0;
	}

	.player-controls.stacked .control-btn:focus-visible,
	.player-controls.stacked .seek-bar:focus-visible {
		outline: 2px solid var(--text-primary);
		outline-offset: 2px;
	}

	.player-controls.stacked .time {
		color: var(--text-secondary);
		font-size: var(--text-xs);
		min-width: 40px;
	}

	.player-controls.stacked .time:last-child {
		text-align: right;
	}

	.player-controls.stacked .seek-bar {
		height: 20px;
		margin: -8px 0;
		--fill: var(--text-primary);
		--rest: color-mix(in srgb, var(--text-primary) 28%, transparent);
	}

	.player-controls.stacked .seek-bar::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 2px;
		margin-top: 8px;
		background: linear-gradient(
			to right,
			var(--fill) 0%,
			var(--fill) var(--progress, 0%),
			var(--rest) var(--progress, 0%),
			var(--rest) 100%
		);
		transition: background 150ms cubic-bezier(0.2, 0, 0, 1);
	}

	.player-controls.stacked .seek-bar::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: var(--rest);
	}

	.player-controls.stacked .seek-bar::-moz-range-progress {
		height: 4px;
		border-radius: 2px;
		background: var(--fill);
	}

	.player-controls.stacked .seek-bar::-webkit-slider-thumb {
		width: 12px;
		height: 12px;
		margin-top: -4px;
		background: var(--text-primary);
		opacity: 0;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
		transform: none;
		transition: opacity 150ms cubic-bezier(0.2, 0, 0, 1);
	}

	.player-controls.stacked .seek-bar::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: var(--text-primary);
		border: none;
		opacity: 0;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
		transition: opacity 150ms cubic-bezier(0.2, 0, 0, 1);
	}

	.player-controls.stacked .seek-bar:hover,
	.player-controls.stacked .seek-bar:focus-visible,
	.player-controls.stacked .seek-bar:active {
		--fill: var(--accent);
	}

	.player-controls.stacked .seek-bar:hover::-webkit-slider-thumb,
	.player-controls.stacked .seek-bar:focus-visible::-webkit-slider-thumb,
	.player-controls.stacked .seek-bar:active::-webkit-slider-thumb {
		opacity: 1;
		transform: none;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	}

	.player-controls.stacked .seek-bar:hover::-moz-range-thumb,
	.player-controls.stacked .seek-bar:focus-visible::-moz-range-thumb,
	.player-controls.stacked .seek-bar:active::-moz-range-thumb {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.player-controls.stacked .control-btn,
		.player-controls.stacked .control-btn:active,
		.player-controls.stacked .control-btn.play-pause:hover {
			transform: none;
			transition: color 150ms, background 150ms;
		}
	}

	.control-btn.shuffle svg {
		width: 18px;
		height: 18px;
	}

	/* the step count lives inside the svg so it scales with the glyph; the button
	   must pass the app font down — a <button> otherwise carries the UA font */
	.control-btn.skip {
		font-family: inherit;
	}

	/* lining figures: serif fonts (georgia, the default) otherwise drop the 5 below the 1 */
	.control-btn.skip svg text {
		fill: currentColor;
		font-variant-numeric: lining-nums tabular-nums;
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

	.seek-bar {
		flex: 1;
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

	@media (max-width: 768px) {
		.player-controls {
			display: contents;
		}

		.control-btn {
			grid-row: 1;
			padding: 0.5rem;
		}

		.control-btn.prev,
		.control-btn.infinity {
			grid-column: 4;
		}

		.control-btn.play-pause {
			grid-column: 5;
		}

		.control-btn.next {
			grid-column: 6;
		}

		.control-btn.repeat {
			grid-column: 7;
		}

		.control-btn.shuffle {
			display: none;
		}

		.player-controls.stacked .transport {
			display: contents;
		}

		.player-controls.stacked .control-btn {
			padding: 0.5rem;
		}

		/* the stage bar on a phone is spotify's compact bar: art, title, heart, play.
		   prev/next/repeat live in the queue and the now-playing view */
		.player-controls.stacked .control-btn.prev,
		.player-controls.stacked .control-btn.next,
		.player-controls.stacked .control-btn.repeat {
			display: none;
		}

		.player-controls.stacked .control-btn.play-pause {
			grid-column: 8;
			justify-self: end;
		}

		/* skips sit on the scrubber row, under the thumb, not in the transport row */
		.control-btn.skip {
			grid-row: 2;
			padding: 0.25rem;
			justify-self: center;
		}

		.control-btn.skip-back {
			grid-column: 1;
		}

		.control-btn.skip-forward {
			grid-column: 8;
		}

		.control-btn.skip svg {
			width: 24px;
			height: 24px;
		}

		.control-btn svg {
			width: 28px;
			height: 28px;
		}

		.control-btn.repeat svg {
			width: 22px;
			height: 22px;
		}

		.control-btn.play-pause svg {
			width: 32px;
			height: 32px;
		}

		.time-control {
			grid-row: 2;
			grid-column: 1 / 9;
		}

		.player-controls:has(.skip) .time-control {
			grid-column: 2 / 8;
		}

		/* radio: "live" takes the scrubber's row instead of the control row */
		.live-pill {
			grid-row: 2;
			grid-column: 1 / 9;
			text-align: center;
		}

		.time {
			font-size: var(--text-xs);
			min-width: 38px;
		}

	}
</style>
