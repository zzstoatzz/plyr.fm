<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Icon from '$lib/ui/Icon.svelte';

	let tile: HTMLAnchorElement;
	let canvas: HTMLCanvasElement;
	let summary = $state('');

	onMount(() => {
		const desktop = matchMedia('(min-width: 1240px)');
		let live = true;
		let destroy: (() => void) | undefined;
		const observer = new IntersectionObserver(entries => {
			if (!desktop.matches || !entries.some(entry => entry.isIntersecting)) return;
			observer.disconnect();
			void paint();
		}, { rootMargin: '32px 0px' });
		observer.observe(tile);

		async function paint() {
			try {
				const [{ mountAtlas }, { loadAtlas, atlasSummary }] = await Promise.all([import('./canvas'), import('@plyr/next-core/atlas/load')]);
				if (!live || !desktop.matches) { if (live) observer.observe(tile); return; }
				const atlas = await loadAtlas();
				if (!live || !desktop.matches) { if (live) observer.observe(tile); return; }
				const view = mountAtlas(canvas);
				destroy = view.destroy;
				view.renderer.setData(atlas);
				summary = atlasSummary(atlas);
			} catch {
				destroy?.();
				destroy = undefined;
			}
		}

		return () => { live = false; observer.disconnect(); destroy?.(); };
	});
</script>

<a class="tile" href={resolve('/(app)/atlas')} bind:this={tile} data-testid="home-atlas" aria-label={summary ? `Open the atlas, ${summary}` : 'Open the atlas'}>
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
	<span class="caption">
		<span><strong>atlas</strong><small>{summary || 'the catalog, mapped by sound'}</small></span>
		<Icon name="chevron" size={17} />
	</span>
</a>

<style>
	.tile { display: none; }
	@media (min-width: 1240px) {
		.tile { display: flex; grid-area: atlas; position: relative; isolation: isolate; align-items: end; min-height: 17rem; overflow: hidden; border: 1px solid var(--line); border-radius: 1.15rem; background: var(--surface); }
		canvas { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
		.caption { display: flex; align-items: end; justify-content: space-between; gap: 0.5rem; width: 100%; padding: 1.2rem 1rem 0.85rem; background: linear-gradient(transparent, var(--surface) 52%); }
		small { display: block; color: var(--muted); font-size: var(--t-12-8); }
	}
</style>
