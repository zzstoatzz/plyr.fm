<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { API_URL } from '$lib/config';
	import { player } from '$lib/player.svelte';
	import type { Track } from '$lib/types';
	import { AtlasRenderer, type AtlasData, type AtlasPoint } from './renderer';

	let canvasEl: HTMLCanvasElement;
	let renderer: AtlasRenderer | null = null;

	let loading = $state(true);
	let loadError = $state('');
	let stats = $state('');
	let tooltip = $state<{
		visible: boolean;
		x: number;
		y: number;
		title: string;
		meta: string;
		kind: 'track' | 'artist';
	}>({ visible: false, x: 0, y: 0, title: '', meta: '', kind: 'track' });
	let starting = $state<number | null>(null);

	async function playPoint(point: AtlasPoint): Promise<void> {
		starting = point.id;
		try {
			const response = await fetch(`${API_URL}/tracks/${point.id}`, {
				credentials: 'include'
			});
			if (!response.ok) {
				console.error('atlas: failed to load track', point.id, response.status);
				return;
			}
			const track: Track = await response.json();
			player.playTrack(track);
		} catch (e) {
			console.error('atlas: failed to start playback', e);
		} finally {
			starting = null;
		}
	}

	function placeTooltip(sx: number, sy: number): { x: number; y: number } {
		const pad = 12;
		const width = 260;
		let x = sx + 16;
		if (x + width > window.innerWidth - pad) x = sx - width - 16;
		return { x: Math.max(pad, x), y: Math.max(pad, sy - 60) };
	}

	onMount(() => {
		renderer = new AtlasRenderer(canvasEl, {
			onHover: (point, sx, sy) => {
				if (!point) {
					if (tooltip.kind === 'track') tooltip.visible = false;
					return;
				}
				const pos = placeTooltip(sx, sy);
				tooltip = {
					visible: true,
					x: pos.x,
					y: pos.y,
					title: point.title,
					meta: `${point.artist} · ${point.plays} ${point.plays === 1 ? 'play' : 'plays'}`,
					kind: 'track'
				};
			},
			onHoverArtist: (artist, sx, sy) => {
				if (!artist) {
					if (tooltip.kind === 'artist') tooltip.visible = false;
					return;
				}
				const pos = placeTooltip(sx, sy);
				tooltip = {
					visible: true,
					x: pos.x,
					y: pos.y,
					title: artist.name,
					meta: `@${artist.handle} · ${artist.count} tracks`,
					kind: 'artist'
				};
			},
			onActivate: (point) => void playPoint(point),
			onActivateArtist: (artist) => void goto(`/u/${artist.handle}`)
		});

		// the live map comes from /stats/atlas (rebuilt daily); the static
		// fallback exists for local dev, where a gitignored copy of
		// atlas.json can sit in frontend/static
		fetch(`${API_URL}/stats/atlas`)
			.then((r) => {
				if (r.ok) return r.json();
				return fetch('/atlas.json').then((fallback) => {
					if (!fallback.ok) throw new Error(`atlas: ${r.status}`);
					return fallback.json();
				});
			})
			.then((data: AtlasData) => {
				renderer?.setData(data);
				stats = `${data.meta.nTracks} tracks · ${data.clusters.coarse.length} regions · ${data.clusters.fine.length} clusters`;
				loading = false;
			})
			.catch((e: unknown) => {
				console.error('atlas: failed to load data', e);
				loadError = 'failed to load the atlas';
				loading = false;
			});

		return () => renderer?.destroy();
	});
</script>

<svelte:head>
	<title>atlas · plyr.fm</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta
		name="description"
		content="a 2D semantic map of the plyr.fm catalog — tracks clustered by how they sound"
	/>
</svelte:head>

<div class="atlas-page">
	<header class="atlas-header">
		<div>
			<h1>atlas</h1>
			<p class="subtitle">the catalog, mapped by sound — zoom in, click a track to play it</p>
		</div>
		{#if stats}
			<span class="stats">{stats}</span>
		{/if}
	</header>

	<div class="stage">
		<canvas bind:this={canvasEl}></canvas>
		{#if loading}
			<div class="overlay">charting the catalog…</div>
		{:else if loadError}
			<div class="overlay">{loadError}</div>
		{/if}
		{#if starting !== null}
			<div class="starting">starting playback…</div>
		{/if}
		{#if tooltip.visible}
			<div class="tooltip" style="left: {tooltip.x}px; top: {tooltip.y}px">
				<span class="tooltip-title">{tooltip.title}</span>
				<span class="tooltip-meta">{tooltip.meta}</span>
				<span class="tooltip-hint">
					{tooltip.kind === 'track' ? 'click to play' : 'click for profile'}
				</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.atlas-page {
		display: flex;
		flex-direction: column;
		height: calc(
			100vh - var(--header-height, 0px) - var(--player-height, 0px) -
				env(safe-area-inset-bottom, 0px)
		);
		overflow: hidden;
	}

	@supports (height: 100dvh) {
		.atlas-page {
			height: calc(
				100dvh - var(--header-height, 0px) - var(--player-height, 0px) -
					env(safe-area-inset-bottom, 0px)
			);
		}
	}

	.atlas-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem 0.5rem;
		flex-wrap: wrap;
	}

	h1 {
		font-size: var(--text-page-heading, 1.4rem);
		margin: 0;
	}

	.subtitle {
		margin: 0.1rem 0 0;
		color: var(--text-tertiary);
		font-size: var(--text-sm, 0.85rem);
	}

	.stats {
		color: var(--text-muted, #666);
		font-size: var(--text-sm, 0.8rem);
		font-family: monospace;
	}

	.stage {
		position: relative;
		flex: 1;
		min-height: 0;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: grab;
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--text-tertiary);
		font-family: monospace;
		font-size: var(--text-sm, 0.85rem);
		pointer-events: none;
	}

	.starting {
		position: absolute;
		top: 0.75rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle, #282828);
		border-radius: 6px;
		padding: 0.3rem 0.8rem;
		font-size: var(--text-sm, 0.8rem);
		color: var(--text-secondary);
		pointer-events: none;
	}

	.tooltip {
		position: absolute;
		max-width: 260px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default, #333);
		border-radius: 6px;
		padding: 0.5rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		pointer-events: none;
		z-index: 5;
	}

	.tooltip-title {
		color: var(--text-primary);
		font-size: var(--text-sm, 0.85rem);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tooltip-meta {
		color: var(--text-tertiary);
		font-size: var(--text-xs, 0.75rem);
	}

	.tooltip-hint {
		color: var(--text-muted, #666);
		font-size: var(--text-xs, 0.7rem);
	}

	@media (max-width: 600px) {
		.atlas-header {
			padding: 0.6rem 0.8rem 0.4rem;
		}

		.stats {
			display: none;
		}
	}
</style>
