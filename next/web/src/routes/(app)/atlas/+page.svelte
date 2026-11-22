<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount, tick } from 'svelte';
	import { atlasSummary, loadAtlas } from '$lib/atlas/catalog';
	import { mountAtlas } from '$lib/atlas/canvas';
	import type { AtlasData } from '$lib/atlas/types';
	import { trackEmbed } from '$lib/embed/catalog';
	import { player } from '$lib/player.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	let canvas: HTMLCanvasElement;
	let map: ReturnType<typeof mountAtlas> | undefined;
	let retry = $state<HTMLButtonElement>();
	let data = $state.raw<AtlasData>();
	let error = $state('');
	let loading = $state(false);
	let starting = $state('');
	let playbackError = $state('');
	let tooltip = $state<{ x: number; y: number; name: string; detail: string }>();
	let headerHeight = $state(0);
	let underChrome = $state(0);
	let pending: AbortController | undefined;
	const summary = $derived(data ? atlasSummary(data) : '');
	const moves = new Map<string, [number, number]>([
		['ArrowLeft', [60, 0]], ['ArrowRight', [-60, 0]], ['ArrowUp', [0, 60]], ['ArrowDown', [0, -60]]
	]);

	$effect(() => {
		if (data) map?.renderer.setInsets(headerHeight, underChrome + 64);
	});

	onMount(() => {
		void refresh();
		return () => {
			pending?.abort();
			map?.destroy();
			active = false;
		};
	});

	let active = true;
	async function refresh() {
		if (loading) return;
		loading = true;
		try {
			const atlas = await loadAtlas();
			if (!active) return;
			map ??= mountAtlas(canvas, {
				onHover: (point, x, y) => { tooltip = point ? place(x, y, point.title, `${point.artist} · ${point.plays} ${point.plays === 1 ? 'play' : 'plays'}`) : undefined; },
				onHoverArtist: (artist, x, y) => { tooltip = artist ? place(x, y, artist.name, `@${artist.handle} · ${artist.count} tracks`) : undefined; },
				onActivate: point => { void play(point.id, point.title); },
				onActivateArtist: artist => { void goto(resolve('/(app)/u/[actor]', { actor: artist.handle || artist.did })); }
			});
			map.renderer.setData(atlas);
			const focusedRetry = document.activeElement === retry;
			data = atlas;
			error = '';
			if (focusedRetry) {
				await tick();
				if (active && document.activeElement === document.body) canvas.focus({ preventScroll: true });
			}
		} catch {
			if (active) error = 'could not load the atlas.';
		} finally {
			loading = false;
		}
	}

	function place(x: number, y: number, name: string, detail: string) {
		return { x: Math.max(8, Math.min(canvas.clientWidth - 252, x + 16)), y: Math.max(8, y - 60), name, detail };
	}

	async function play(id: number, title: string) {
		pending?.abort();
		const request = new AbortController();
		pending = request;
		starting = title;
		playbackError = '';
		const timeout = setTimeout(() => {
			if (!active || pending !== request) return;
			request.abort();
			pending = undefined;
			starting = '';
			playbackError = 'could not play this track from the atlas. select it to try again.';
		}, 10_000);
		try {
			const track = await trackEmbed(String(id), (input, init) => fetch(input, { ...init, signal: request.signal }));
			if (!request.signal.aborted) player.play(track);
		} catch {
			if (!request.signal.aborted) playbackError = 'could not play this track from the atlas.';
		} finally {
			clearTimeout(timeout);
			if (pending === request) { pending = undefined; starting = ''; }
		}
	}

	function keys(event: KeyboardEvent) {
		const move = moves.get(event.key);
		if (move) map?.renderer.panBy(...move);
		else if (event.key === '+' || event.key === '=') map?.renderer.zoomBy(1.25);
		else if (event.key === '-') map?.renderer.zoomBy(0.8);
		else return;
		event.preventDefault();
	}
</script>

<svelte:head><title>atlas · plyr.fm</title></svelte:head>

<section class="atlas">
	<div class="under" aria-hidden="true" bind:clientHeight={underChrome}></div>
	<div class="stage">
		<canvas bind:this={canvas} tabindex={data ? 0 : -1} aria-label="Catalog atlas" aria-describedby="atlas-help" onkeydown={keys}></canvas>
		{#if !data}
			<div class="notice">
				{#if error}
					{#if !loading}<p role="alert">{error}</p>{/if}
					<button class="text-button" type="button" bind:this={retry} aria-disabled={loading} onclick={refresh}>{loading ? 'loading the atlas…' : 'try again'}</button>
				{:else}<Loading label="loading the atlas" />{/if}
			</div>
		{:else}
			<div class="zoom">
				<button class="icon-button" type="button" aria-label="Zoom in" onclick={() => map?.renderer.zoomBy(1.25)}>+</button>
				<button class="icon-button" type="button" aria-label="Zoom out" onclick={() => map?.renderer.zoomBy(0.8)}>−</button>
			</div>
		{/if}
		{#if tooltip}<div class="tooltip" style:left={tooltip.x + 'px'} style:top={tooltip.y + 'px'}><strong>{tooltip.name}</strong><p>{tooltip.detail}</p></div>{/if}
		{#if starting || playbackError}<p class="playback-status" role="status">{starting ? `starting ${starting}…` : playbackError}</p>{/if}
	</div>
	<header bind:clientHeight={headerHeight}>
		<h1>atlas</h1>
		<p id="atlas-help">the catalog, mapped by sound. zoom in and select a track to play it.</p>
		{#if summary}<p class="summary">{summary}</p>{/if}
	</header>
</section>

<style>
	/* fills everything between the nav and the player; on phones it runs under the floating tabs and dock, so overlays lift by --under */
	.atlas { --pad: clamp(1rem, 3vw, 2.25rem); --under: 0px; position: relative; height: calc(100dvh - var(--chrome-bottom, 0px)); overflow: hidden; background: var(--bg); }
	.stage { position: absolute; inset: 0; }
	.under { position: absolute; bottom: 0; height: var(--under); width: 1px; visibility: hidden; }
	canvas { position: absolute; inset: 0; display: block; touch-action: none; }
	canvas:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
	header { position: absolute; top: 0; left: 0; display: grid; gap: 0.25rem; max-width: min(36rem, 100%); padding: max(var(--pad), env(safe-area-inset-top)) var(--pad) var(--pad); pointer-events: none; text-shadow: 0 0 0.5rem var(--bg), 0 0 1rem var(--bg), 0 0 1.5rem var(--bg); }
	header p, .tooltip p { color: var(--muted); }
	.summary { font-size: var(--t-14); }
	.zoom { position: absolute; right: var(--pad); bottom: calc(var(--under) + var(--pad)); display: flex; gap: 0.15rem; }
	.zoom, .tooltip, .playback-status { border: 1px solid var(--line); border-radius: 0.65rem; background: color-mix(in srgb, var(--surface) 82%, transparent); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
	.zoom button { font-size: 1.35rem; }
	.notice { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; }
	.tooltip { position: absolute; width: min(244px, calc(100% - 16px)); padding: 0.55rem 0.65rem; overflow-wrap: anywhere; pointer-events: none; }
	.playback-status { position: absolute; left: var(--pad); bottom: calc(var(--under) + var(--pad)); max-width: calc(100% - 8rem - 2 * var(--pad)); padding: 0.4rem 0.65rem; pointer-events: none; }
	@media (max-width: 720px) {
		.atlas { --under: var(--chrome-bottom, 0px); height: 100dvh; margin-bottom: calc(-1 * var(--chrome-bottom, 0px)); }
	}
</style>
