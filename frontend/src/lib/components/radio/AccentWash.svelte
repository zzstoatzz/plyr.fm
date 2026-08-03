<script lang="ts">
	import { onMount } from 'svelte';
	import type { ArtworkAccent } from '$lib/utils/artwork-accent';
	import { themeColorFromAccent } from '$lib/utils/artwork-accent';

	let { accent }: { accent: ArtworkAccent | null } = $props();

	// double-buffered wash: the incoming accent renders on the inactive layer,
	// then the layers cross-fade — a track change dissolves instead of snapping.
	let layers = $state<[ArtworkAccent | null, ArtworkAccent | null]>([null, null]);
	let active = $state<0 | 1>(0);
	let lastKey = '';

	$effect(() => {
		const key = accent ? `${accent.primary}|${accent.secondary}` : '';
		if (key === lastKey) return;
		lastKey = key;
		const next = active === 0 ? 1 : 0;
		layers[next] = accent;
		// let the new layer paint at opacity 0 before fading it in
		window.requestAnimationFrame(() => (active = next));
	});

	// tint mobile browser chrome to match; restore the app default on leave.
	const DEFAULT_THEME_COLOR = '#0a0a0a';
	let themeMeta: HTMLMetaElement | null = null;
	onMount(() => {
		themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
		return () => themeMeta?.setAttribute('content', DEFAULT_THEME_COLOR);
	});
	$effect(() => {
		themeMeta?.setAttribute(
			'content',
			accent ? themeColorFromAccent(accent) : DEFAULT_THEME_COLOR
		);
	});

	function layerStyle(layer: ArtworkAccent | null): string {
		if (!layer) return 'opacity: 0';
		return `--wash-a: ${layer.primary}; --wash-b: ${layer.secondary};`;
	}
</script>

<div class="ambient" aria-hidden="true">
	{#each [0, 1] as index (index)}
		<div class="layer" class:active={active === index && layers[index] !== null} style={layerStyle(layers[index])}></div>
	{/each}
</div>

<style>
	.ambient {
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
	}

	/* plain radial gradients only — SVG noise filters band on this backdrop */
	.layer {
		position: absolute;
		inset: 0;
		opacity: 0;
		transition: opacity 1.4s ease;
		background:
			radial-gradient(
				90% 55% at 50% 18%,
				rgb(var(--wash-a, 0 0 0) / 0.16),
				rgb(var(--wash-a, 0 0 0) / 0.05) 55%,
				transparent 78%
			),
			radial-gradient(
				60% 40% at 72% 68%,
				rgb(var(--wash-b, 0 0 0) / 0.08),
				transparent 70%
			);
	}

	.layer.active {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.layer {
			transition: opacity 0.4s ease;
		}
	}
</style>
