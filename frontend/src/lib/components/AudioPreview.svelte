<script lang="ts">
	import { onDestroy } from 'svelte';
	import Waveform from './Waveform.svelte';
	import {
		audioFormatOf,
		canRenderWaveform,
		formatClock,
		formatFileSize,
		mediaDuration,
		waveformMaxSeconds,
		WAVEFORM_DECODE_RATE
	} from '$lib/audio/probe';
	import type { StagedTransfer } from '$lib/staged-transfer.svelte';

	interface Props {
		/** the audio to look at and play — a chosen file or a fresh recording. */
		source: Blob;
		/** shown as the title; a File's own name when omitted. */
		name?: string;
		/** a length known before the browser has scanned the container (a recording's tick count). */
		fallbackDurationSeconds?: number;
		/** the file's journey into staging, when it started ahead of the form. */
		transfer?: StagedTransfer | null;
		height?: number;
	}

	let {
		source,
		name = source instanceof File ? source.name : '',
		fallbackDurationSeconds = 0,
		transfer = null,
		height = 72
	}: Props = $props();

	let audioEl = $state<HTMLAudioElement | null>(null);
	let currentTime = $state(0);
	let scannedDuration = $state<number | null>(null);
	let scanned = $state(false);
	let playable = $state(true);
	let isPlaying = $state(false);
	let objectUrl = $state<string | null>(null);

	const format = $derived(audioFormatOf(name, source.type));
	const durationSeconds = $derived(
		scannedDuration ?? (fallbackDurationSeconds > 0 ? fallbackDurationSeconds : null)
	);
	const waveform = $derived(
		scanned && canRenderWaveform(source.size, durationSeconds, waveformMaxSeconds())
	);
	const progress = $derived(
		durationSeconds !== null && durationSeconds > 0 ? currentTime / durationSeconds : 0
	);
	const facts = $derived(
		[
			format,
			formatFileSize(source.size),
			durationSeconds === null ? null : formatClock(durationSeconds)
		]
			.filter((fact) => fact !== null && fact !== '')
			.join(' · ')
	);

	$effect(() => {
		const url = URL.createObjectURL(source);
		objectUrl = url;
		scannedDuration = null;
		scanned = false;
		playable = true;
		isPlaying = false;
		currentTime = 0;
		return () => URL.revokeObjectURL(url);
	});

	onDestroy(() => {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
	});

	async function handleLoadedMetadata() {
		if (!audioEl) return;
		scannedDuration = await mediaDuration(audioEl);
		scanned = true;
	}

	function handleError() {
		playable = false;
		scanned = true;
	}

	function togglePlay() {
		if (!audioEl) return;
		if (isPlaying) audioEl.pause();
		else audioEl.play().catch((e) => console.error('playback failed:', e));
	}

	function seek(ratio: number) {
		if (audioEl && durationSeconds !== null) audioEl.currentTime = ratio * durationSeconds;
	}
</script>

<div class="preview">
	<div class="heading">
		{#if name}<span class="name">{name}</span>{/if}
		<span class="facts">{facts}</span>
	</div>

	{#if waveform}
		<div class="wf-wrap">
			<Waveform
				{source}
				decodeSampleRate={WAVEFORM_DECODE_RATE}
				{progress}
				onSeek={playable ? seek : undefined}
				{height}
			/>
		</div>
	{:else if scanned && playable}
		<p class="note">no waveform for a file this long</p>
	{/if}

	{#if objectUrl}
		<audio
			bind:this={audioEl}
			bind:currentTime
			src={objectUrl}
			preload="metadata"
			onloadedmetadata={handleLoadedMetadata}
			onerror={handleError}
			onplay={() => (isPlaying = true)}
			onpause={() => (isPlaying = false)}
			onended={() => (isPlaying = false)}
		></audio>
	{/if}

	{#if playable}
		<div class="playback-row">
			<button
				type="button"
				class="play-btn"
				onclick={togglePlay}
				aria-label={isPlaying ? 'pause' : 'play'}
			>
				{#if isPlaying}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<rect x="6" y="5" width="4" height="14" rx="1" />
						<rect x="14" y="5" width="4" height="14" rx="1" />
					</svg>
				{:else}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M8 5v14l11-7z" />
					</svg>
				{/if}
			</button>
			<span class="time-display" aria-live="off">
				{formatClock(currentTime)} / {durationSeconds === null
					? '–:––'
					: formatClock(durationSeconds)}
			</span>
		</div>
	{:else}
		<p class="note">this browser can't play {format || 'this file'} — it will still upload</p>
	{/if}

	{#if transfer}
		<div class="transfer" class:failed={transfer.status === 'failed'}>
			<progress max={transfer.total} value={transfer.loaded} aria-label="file transfer"></progress>
			<div class="transfer-row">
				{#if transfer.status === 'transferred'}
					<span class="transfer-text">file received — publish when you're ready</span>
				{:else if transfer.status === 'failed'}
					<span class="transfer-text">{transfer.error ?? "your file didn't finish sending"}</span>
					<button type="button" class="retry" onclick={() => transfer.retry()}>retry</button>
				{:else if transfer.status === 'transferring'}
					<span class="transfer-text">receiving your file… {transfer.progressPercent}%</span>
				{:else}
					<span class="transfer-text">getting ready…</span>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.preview {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
		background: var(--bg-secondary);
	}

	.heading {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.name {
		font-size: var(--text-sm);
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}

	.facts {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.wf-wrap {
		padding: 0.25rem 0;
		--wf-base: color-mix(in srgb, var(--text-muted) 55%, transparent);
	}

	.note {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}

	.playback-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.play-btn {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-full);
		background: var(--accent);
		color: var(--accent-contrast, var(--text-primary));
		border: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		flex-shrink: 0;
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 28%, transparent);
	}

	.play-btn:hover {
		background: var(--accent-hover);
	}

	.time-display {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.02em;
	}

	.transfer {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	progress {
		width: 100%;
		height: 4px;
		appearance: none;
		border: none;
		border-radius: var(--radius-full);
		overflow: hidden;
		background: var(--bg-tertiary);
	}

	progress::-webkit-progress-bar {
		background: var(--bg-tertiary);
	}

	progress::-webkit-progress-value {
		background: var(--accent);
		transition: width 200ms ease;
	}

	progress::-moz-progress-bar {
		background: var(--accent);
	}

	.failed progress::-webkit-progress-value {
		background: var(--error);
	}

	.failed progress::-moz-progress-bar {
		background: var(--error);
	}

	.transfer-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.transfer-text {
		font-size: var(--text-xs);
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.failed .transfer-text {
		color: var(--error);
	}

	.retry {
		font-size: var(--text-xs);
		padding: 0.25rem 0.625rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--border-default);
		background: transparent;
		color: var(--text-primary);
		cursor: pointer;
	}

	.retry:hover {
		background: var(--bg-hover);
	}
</style>
