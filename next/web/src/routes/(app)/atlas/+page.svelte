<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { loadAtlas } from '$lib/atlas/catalog';
	import { AtlasRenderer } from '$lib/atlas/renderer';
	import type { AtlasData } from '$lib/atlas/types';
	import { trackEmbed } from '$lib/embed/catalog';
	import { player } from '$lib/player.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	let canvas: HTMLCanvasElement;
	let renderer: AtlasRenderer;
	let data = $state.raw<AtlasData>();
	let error = $state('');
	let starting = $state('');
	let playbackError = $state('');
	let tooltip = $state<{ x: number; y: number; name: string; detail: string }>();
	let pending: AbortController | undefined;
	const summary = $derived(data ? [tally(data.meta.nTracks, 'track'), tally(data.clusters.coarse.length, 'region'), tally(data.clusters.fine.length, 'cluster')].join(' · ') : '');
	const moves = new Map<string, [number, number]>([
		['ArrowLeft', [60, 0]], ['ArrowRight', [-60, 0]], ['ArrowUp', [0, 60]], ['ArrowDown', [0, -60]]
	]);

	onMount(() => {
		const system = matchMedia('(prefers-color-scheme: dark)');
		const root = document.documentElement;
		const dark = () => root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && system.matches);
		const theme = () => renderer.setDark(dark());
		const observer = new MutationObserver(theme);
		renderer = new AtlasRenderer(canvas, {
			onHover: (point, x, y) => { tooltip = point ? place(x, y, point.title, `${point.artist} · ${point.plays} ${point.plays === 1 ? 'play' : 'plays'}`) : undefined; },
			onHoverArtist: (artist, x, y) => { tooltip = artist ? place(x, y, artist.name, `@${artist.handle} · ${artist.count} tracks`) : undefined; },
			onActivate: point => { void play(point.id, point.title); },
			onActivateArtist: artist => { void goto(resolve('/(app)/u/[actor]', { actor: artist.handle || artist.did })); }
		}, { dark: dark(), preview: false });
		observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
		system.addEventListener('change', theme);
		void refresh();
		return () => {
			observer.disconnect();
			system.removeEventListener('change', theme);
			pending?.abort();
			renderer.destroy();
			active = false;
		};
	});

	let active = true;
	async function refresh() {
		error = '';
		try {
			const atlas = await loadAtlas();
			if (!active) return;
			data = atlas;
			renderer.setData(atlas);
		} catch {
			if (active) error = 'could not load the atlas.';
		}
	}

	function place(x: number, y: number, name: string, detail: string) {
		return { x: Math.max(8, Math.min(canvas.clientWidth - 252, x + 16)), y: Math.max(8, y - 60), name, detail };
	}

	function tally(count: number, singular: string) {
		return `${count.toLocaleString()} ${singular}${count === 1 ? '' : 's'}`;
	}

	async function play(id: number, title: string) {
		pending?.abort();
		const request = new AbortController();
		pending = request;
		starting = title;
		playbackError = '';
		try {
			const track = await trackEmbed(String(id), (input, init) => fetch(input, { ...init, signal: request.signal }));
			if (!request.signal.aborted) player.play(track);
		} catch {
			if (!request.signal.aborted) playbackError = 'could not play this track from the atlas.';
		} finally {
			if (pending === request) { pending = undefined; starting = ''; }
		}
	}

	function keys(event: KeyboardEvent) {
		const move = moves.get(event.key);
		if (move) renderer.panBy(...move);
		else if (event.key === '+' || event.key === '=') renderer.zoomBy(1.25);
		else if (event.key === '-') renderer.zoomBy(0.8);
		else return;
		event.preventDefault();
	}
</script>

<svelte:head><title>atlas · plyr.fm</title></svelte:head>

<section class="page-content atlas">
	<header>
		<h1>atlas</h1>
		<p id="atlas-help">the catalog, mapped by sound. zoom in and select a track to play it.</p>
		{#if summary}<p class="summary">{summary}</p>{/if}
	</header>
	<div class="stage">
		<canvas bind:this={canvas} tabindex={data ? 0 : -1} aria-label="Catalog atlas" aria-describedby="atlas-help" onkeydown={keys}></canvas>
		{#if !data}
			<div class="notice">
				{#if error}<p role="alert">{error}</p><button class="text-button" type="button" onclick={refresh}>try again</button>
				{:else}<Loading label="loading the atlas" />{/if}
			</div>
		{:else}
			<div class="zoom">
				<button class="icon-button" type="button" aria-label="Zoom in" onclick={() => renderer.zoomBy(1.25)}>+</button>
				<button class="icon-button" type="button" aria-label="Zoom out" onclick={() => renderer.zoomBy(0.8)}>−</button>
			</div>
		{/if}
		{#if tooltip}<div class="tooltip" style:left={tooltip.x + 'px'} style:top={tooltip.y + 'px'}><strong>{tooltip.name}</strong><p>{tooltip.detail}</p></div>{/if}
		{#if starting || playbackError}<p class="playback-status" role="status">{starting ? `starting ${starting}…` : playbackError}</p>{/if}
	</div>
</section>

<style>
	.atlas { display: grid; gap: 1rem; }
	header { display: grid; gap: 0.25rem; }
	header p, .tooltip p { color: var(--muted); }
	.summary { font-size: 0.875rem; }
	.stage { position: relative; min-height: min(30rem, 65dvh); height: calc(100dvh - 14rem); overflow: hidden; border: 1px solid var(--line); border-radius: 0.9rem; background: var(--surface); }
	canvas { position: absolute; inset: 0; display: block; touch-action: none; }
	canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	.zoom { position: absolute; right: 0.75rem; bottom: 0.75rem; display: flex; gap: 0.15rem; }
	.zoom, .tooltip, .playback-status { border: 1px solid var(--line); border-radius: 0.65rem; background: var(--surface); }
	.zoom button { font-size: 1.35rem; }
	.notice { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; }
	.tooltip { position: absolute; width: min(244px, calc(100% - 16px)); padding: 0.55rem 0.65rem; overflow-wrap: anywhere; pointer-events: none; }
	.playback-status { position: absolute; left: 0.65rem; bottom: 0.75rem; max-width: calc(100% - 8rem); padding: 0.4rem 0.65rem; pointer-events: none; }
</style>
