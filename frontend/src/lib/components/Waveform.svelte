<script lang="ts">
	import { extractPeaks } from '$lib/audio/peaks';

	interface Props {
		/** pre-computed normalized peaks (0..1). if omitted, pass `source` instead. */
		peaks?: number[];
		/** audio source — a Blob (for recordings) or a URL string (for remote tracks). */
		source?: Blob | string | null;
		/** number of bars to render when decoding from source. ignored if peaks is provided. */
		barCount?: number;
		/** visual height of the waveform in pixels. */
		height?: number;
		/** playback progress 0..1, drives the playhead overlay. */
		progress?: number;
		/** click-to-seek callback. ratio is 0..1. if omitted, the waveform is not interactive. */
		onSeek?: (_ratio: number) => void;
		/** aria label for the svg. */
		label?: string;
	}

	let {
		peaks: peaksProp,
		source = null,
		barCount = 120,
		height = 64,
		progress = 0,
		onSeek,
		label = 'waveform'
	}: Props = $props();

	const BAR_WIDTH = 3;
	const BAR_GAP = 2;
	const BAR_STEP = BAR_WIDTH + BAR_GAP;
	const BAR_MIN_HEIGHT = 3;
	const BAR_RADIUS = BAR_WIDTH / 2;

	let decodedPeaks = $state<number[] | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// stable clip-path id per instance so multiple waveforms don't collide
	const clipId = `wf-clip-${Math.random().toString(36).slice(2, 10)}`;

	$effect(() => {
		// if caller supplied peaks directly, skip decoding entirely
		if (peaksProp) {
			decodedPeaks = null;
			loading = false;
			error = null;
			return;
		}
		if (!source) {
			decodedPeaks = null;
			loading = false;
			error = null;
			return;
		}

		let aborted = false;
		loading = true;
		error = null;

		(async () => {
			try {
				let result: number[];
				if (typeof source === 'string') {
					const res = await fetch(source);
					if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
					const buf = await res.arrayBuffer();
					if (aborted) return;
					result = await extractPeaks(buf, barCount);
				} else {
					result = await extractPeaks(source, barCount);
				}
				if (aborted) return;
				decodedPeaks = result;
			} catch (e) {
				if (aborted) return;
				console.error('waveform decode error:', e);
				error = e instanceof Error ? e.message : 'failed to decode audio';
				decodedPeaks = null;
			} finally {
				if (!aborted) loading = false;
			}
		})();

		return () => {
			aborted = true;
		};
	});

	const activePeaks = $derived(peaksProp ?? decodedPeaks ?? []);

	// while decoding, show a flat ghost row so layout stays stable
	const showPlaceholder = $derived(loading && activePeaks.length === 0);
	const renderPeaks = $derived(
		showPlaceholder ? new Array<number>(barCount).fill(0.15) : activePeaks
	);

	const intrinsicWidth = $derived(Math.max(1, renderPeaks.length * BAR_STEP));
	const clampedProgress = $derived(Math.max(0, Math.min(1, progress)));
	const progressWidth = $derived(clampedProgress * intrinsicWidth);

	function handleClick(event: MouseEvent) {
		if (!onSeek) return;
		const target = event.currentTarget as SVGSVGElement;
		const rect = target.getBoundingClientRect();
		if (rect.width <= 0) return;
		const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
		onSeek(ratio);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!onSeek) return;
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			onSeek(Math.max(0, Math.min(1, clampedProgress - 0.05)));
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			onSeek(Math.max(0, Math.min(1, clampedProgress + 0.05)));
		}
	}
</script>

{#if error && renderPeaks.length === 0}
	<div class="wf-error" style:height="{height}px" title={error} aria-label={label}></div>
{:else if onSeek}
	<svg
		class="wf interactive"
		class:loading={showPlaceholder}
		style:height="{height}px"
		viewBox="0 0 {intrinsicWidth} {height}"
		preserveAspectRatio="none"
		role="slider"
		tabindex="0"
		aria-label={label}
		aria-valuemin={0}
		aria-valuemax={1}
		aria-valuenow={clampedProgress}
		onclick={handleClick}
		onkeydown={handleKeydown}
	>
		<defs>
			<clipPath id={clipId}>
				<rect x="0" y="0" width={progressWidth} height={height} />
			</clipPath>
		</defs>
		<g class="wf-base">
			{#each renderPeaks as peak, i (i)}
				{@const h = Math.max(BAR_MIN_HEIGHT, peak * height)}
				<rect x={i * BAR_STEP} y={(height - h) / 2} width={BAR_WIDTH} height={h} rx={BAR_RADIUS} />
			{/each}
		</g>
		<g class="wf-progress" clip-path="url(#{clipId})">
			{#each renderPeaks as peak, i (i)}
				{@const h = Math.max(BAR_MIN_HEIGHT, peak * height)}
				<rect x={i * BAR_STEP} y={(height - h) / 2} width={BAR_WIDTH} height={h} rx={BAR_RADIUS} />
			{/each}
		</g>
	</svg>
{:else}
	<svg
		class="wf"
		class:loading={showPlaceholder}
		style:height="{height}px"
		viewBox="0 0 {intrinsicWidth} {height}"
		preserveAspectRatio="none"
		aria-label={label}
		role="img"
	>
		<defs>
			<clipPath id={clipId}>
				<rect x="0" y="0" width={progressWidth} height={height} />
			</clipPath>
		</defs>
		<g class="wf-base">
			{#each renderPeaks as peak, i (i)}
				{@const h = Math.max(BAR_MIN_HEIGHT, peak * height)}
				<rect x={i * BAR_STEP} y={(height - h) / 2} width={BAR_WIDTH} height={h} rx={BAR_RADIUS} />
			{/each}
		</g>
		<g class="wf-progress" clip-path="url(#{clipId})">
			{#each renderPeaks as peak, i (i)}
				{@const h = Math.max(BAR_MIN_HEIGHT, peak * height)}
				<rect x={i * BAR_STEP} y={(height - h) / 2} width={BAR_WIDTH} height={h} rx={BAR_RADIUS} />
			{/each}
		</g>
	</svg>
{/if}

<style>
	.wf {
		display: block;
		width: 100%;
		overflow: visible;
	}

	.wf.interactive {
		cursor: pointer;
	}

	.wf.interactive:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.wf-base rect {
		fill: var(--wf-base, color-mix(in srgb, var(--text-muted) 40%, transparent));
		transition: fill 0.2s ease;
	}

	.wf.interactive:hover .wf-base rect {
		fill: var(--wf-base-hover, color-mix(in srgb, var(--text-muted) 65%, transparent));
	}

	.wf-progress rect {
		fill: var(--wf-progress, var(--accent));
	}

	/* subtle glow on the played portion — one filter per group, not per rect */
	.wf-progress {
		filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 55%, transparent));
	}

	.wf.loading {
		animation: wf-pulse 1.4s ease-in-out infinite;
	}

	@keyframes wf-pulse {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 0.9;
		}
	}

	.wf-error {
		width: 100%;
	}
</style>
