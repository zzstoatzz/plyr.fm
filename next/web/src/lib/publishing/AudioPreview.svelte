<script lang="ts">
	import { player } from '$lib/player.svelte';
	import { clock } from '$lib/media/format';
	import { waveformPeaks } from '$lib/media/waveform';
	import Icon from '$lib/ui/Icon.svelte';

	const BARS = 72;
	let { file, duration = $bindable() }: { file: File; duration?: number } = $props();
	let element = $state<HTMLAudioElement>();
	let url = $state<string>();
	let peaks = $state<number[]>();
	let playing = $state(false);
	let time = $state(0);
	const progress = $derived(duration ? time / duration : 0);
	const flat = Array.from({ length: BARS }, () => 0.35);

	$effect(() => {
		const next = URL.createObjectURL(file);
		url = next;
		time = 0;
		playing = false;
		duration = undefined;
		peaks = undefined;
		let live = true;
		waveformPeaks(file, BARS).then(found => { if (live) peaks = found; }, () => {});
		return () => { live = false; URL.revokeObjectURL(next); };
	});

	function toggle() {
		if (!element) return;
		if (element.paused) {
			if (player.playing) player.toggle();
			void element.play().catch(() => {});
		} else element.pause();
	}

	function seek(fraction: number) {
		if (!element || !duration) return;
		element.currentTime = Math.max(0, Math.min(1, fraction)) * duration;
		time = element.currentTime;
	}

	function pointer(event: PointerEvent) {
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
		seek((event.clientX - box.left) / box.width);
	}

	function key(event: KeyboardEvent) {
		if (!duration) return;
		const step = event.key === 'ArrowRight' ? 5 : event.key === 'ArrowLeft' ? -5 : 0;
		if (event.key === 'Home') seek(0);
		else if (event.key === 'End') seek(1);
		else if (step) seek((time + step) / duration);
		else return;
		event.preventDefault();
	}
</script>

<div class="preview">
	<audio
		bind:this={element}
		src={url}
		preload="metadata"
		onloadedmetadata={() => { if (element && Number.isFinite(element.duration)) duration = element.duration; }}
		ontimeupdate={() => { if (element) time = element.currentTime; }}
		onplay={() => { playing = true; }}
		onpause={() => { playing = false; }}
		onended={() => { playing = false; }}
	></audio>
	<button type="button" class="play" aria-label={playing ? 'pause preview' : 'play preview'} onclick={toggle}>
		<Icon name={playing ? 'pause' : 'play'} size={16} />
	</button>
	<div
		class="wave"
		class:pending={!peaks}
		role="slider"
		tabindex="0"
		aria-label="preview position"
		aria-valuemin={0}
		aria-valuemax={Math.round(duration ?? 0)}
		aria-valuenow={Math.round(time)}
		aria-valuetext={`${clock(time)} of ${clock(duration)}`}
		onpointerdown={pointer}
		onkeydown={key}
	>
		{#each peaks ?? flat as peak, index (index)}
			<i class:played={index / BARS < progress} style:height="{Math.max(10, peak * 100)}%"></i>
		{/each}
	</div>
	<span class="time">{clock(time)} / {clock(duration)}</span>
</div>

<style>
	.preview { display: flex; align-items: center; gap: 0.85rem; min-width: 0; padding: 0.5rem 1rem 0.5rem 0.5rem; border-radius: 999px; background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(16px); }
	.play { width: 2.5rem; height: 2.5rem; flex: none; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--accent); color: var(--on-accent); }
	.play:hover { filter: brightness(1.08); }
	.wave { flex: 1; min-width: 0; height: 2.5rem; display: flex; align-items: center; gap: 2px; cursor: pointer; touch-action: none; border-radius: 0.3rem; }
	.wave:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
	.wave i { flex: 1; min-width: 1px; border-radius: 2px; background: color-mix(in srgb, var(--text) 24%, transparent); transition: height 0.25s ease; }
	.wave i.played { background: var(--accent); }
	.wave.pending i { opacity: 0.6; }
	.time { flex: none; font-size: var(--t-12-8); color: var(--faint); font-variant-numeric: tabular-nums; }
	@media (max-width: 30rem) { .time { display: none; } }
	@media (prefers-reduced-motion: reduce) { .wave i { transition: none; } }
</style>
