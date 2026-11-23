<script lang="ts">
	// MOCK ONLY: the "customize your page" panel, drawn over the artist's own page so changes preview live.
	import type { Artist } from '@plyr/next-core/api';
	import Icon from '$lib/ui/Icon.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import CollectionArtwork from '$lib/collections/CollectionArtwork.svelte';
	import { trackArtwork } from '@plyr/next-core/artwork';

	let { artist }: { artist: Artist } = $props();
	const custom = $derived(artist.page ?? {});
	const swatches = ['#e8743b', '#e2b53e', '#66cd9d', '#6a9fff', '#c2a2ff', '#f894b8'];
	const sectionNames = { tracks: 'tracks', albums: 'albums', playlists: 'playlists', likes: 'likes' } as const;
	const order = $derived([...(custom.sections ?? []), ...(['tracks', 'albums', 'playlists', 'likes'] as const).filter(s => !(custom.sections ?? []).includes(s))]);
	const backdrop = $derived(custom.backdrop?.kind ?? 'photo');
</script>

<aside class="editor" aria-label="customize your page" popover="manual" {@attach node => { node.showPopover(); }}>
	<header>
		<div><h2>your page</h2><p>changes show behind this panel as you make them</p></div>
		<button class="done" type="button">done</button>
	</header>

	<section>
		<h3>color</h3>
		<div class="swatches">
			{#each swatches as color (color)}
				<button type="button" class="swatch" class:on={custom.accent === color} style:--c={color} aria-label={`accent ${color}`}></button>
			{/each}
			<button type="button" class="swatch custom" aria-label="pick a color"><Icon name="palette" size={16} /></button>
		</div>
		<p class="hint">buttons and highlights on your page. plyr.fm adjusts it so text stays readable in light and dark.</p>
	</section>

	<section>
		<h3>background</h3>
		<div class="backdrops">
			<button type="button" class:on={backdrop === 'photo'}><span class="tile photo" style:background-image={`url(${artist.avatar_url})`}></span>your photo</button>
			<button type="button" class:on={backdrop === 'image'}><span class="tile img" style:background-image={custom.backdrop?.kind === 'image' ? `url(${custom.backdrop.url})` : undefined}>{#if custom.backdrop?.kind !== 'image'}<Icon name="image" size={18} />{/if}</span>an image</button>
			<button type="button" class:on={backdrop === 'color'}><span class="tile color" style:--c={custom.backdrop?.kind === 'color' ? custom.backdrop.color : custom.accent}></span>a color</button>
			<button type="button" class:on={backdrop === 'plain'}><span class="tile plain"></span>plain</button>
		</div>
	</section>

	<section>
		<h3>pinned <small>{custom.pins?.length ?? 0} of 3</small></h3>
		{#each custom.pins ?? [] as pin, index (index)}
			<div class="row">
				<span class="art">{#if 'list' in pin}<CollectionArtwork list={pin.list} size={40} />{:else}<Artwork src={trackArtwork(pin.track)} size={40} />{/if}</span>
				<span class="copy"><strong class="truncate">{'list' in pin ? pin.list.metadata.name : pin.track.metadata.title}</strong>
					<small class="truncate">{index === 0 ? (pin.note ? `“${pin.note}”` : 'add a note') : ('list' in pin ? pin.list.object : 'track')}</small></span>
				<button class="icon-button" type="button" aria-label="unpin"><Icon name="x" size={16} /></button>
			</div>
		{/each}
		{#if (custom.pins?.length ?? 0) < 3}<button class="add" type="button"><Icon name="plus" size={16} /> pin a release or track</button>{/if}
		<p class="hint">the first one is big and can carry a short note.</p>
	</section>

	<section>
		<h3>links <small>{custom.links?.length ?? 0} of 6</small></h3>
		{#each custom.links ?? [] as link (link.url)}
			<div class="row">
				<span class="glyph"><Icon name="external" size={16} /></span>
				<span class="copy"><strong class="truncate">{link.label}</strong><small class="truncate">{link.url.replace(/^https:\/\//, '')}</small></span>
				<button class="icon-button" type="button" aria-label={`remove ${link.label}`}><Icon name="x" size={16} /></button>
			</div>
		{/each}
		<button class="add" type="button"><Icon name="plus" size={16} /> add a link</button>
	</section>

	<section>
		<h3>sections</h3>
		<p class="hint">drag to reorder. the first one opens by default.</p>
		{#each order as item (item)}
			{@const on = !custom.sections || custom.sections.includes(item)}
			<label class="row toggle">
				<span class="grip" aria-hidden="true"></span>
				<span class="copy"><strong>{sectionNames[item]}</strong></span>
				<input type="checkbox" role="switch" checked={on} aria-label={`show ${item}`} />
			</label>
		{/each}
	</section>
</aside>

<style>
	.editor { position: fixed; margin: 0; padding: 0; height: auto; inset: auto; z-index: 200; display: grid; align-content: start; gap: 0; overflow-y: auto; background: var(--surface); color: var(--text); border-left: 1px solid var(--line); box-shadow: -1rem 0 2.5rem rgb(0 0 0 / 0.18);
		top: 0; right: 0; bottom: 0; left: auto; width: 24rem; border-top: 0; border-bottom: 0; border-right: 0; }
	header { position: sticky; top: 0; z-index: 1; display: flex; align-items: start; justify-content: space-between; gap: 1rem; padding: 1.1rem 1.25rem 0.9rem; background: var(--surface); border-bottom: 1px solid var(--line); }
	h2 { font-size: var(--t-19-2, 1.2rem); }
	header p, .hint { color: var(--muted); font-size: var(--t-13-6); }
	.done { height: 2.25rem; padding: 0 1rem; border: 0; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 700; }
	section { display: grid; gap: 0.6rem; padding: 1rem 1.25rem; border-bottom: 1px solid var(--line); }
	h3 { display: flex; justify-content: space-between; font-size: var(--t-14, 0.875rem); font-weight: 700; }
	h3 small { color: var(--faint); font-weight: 600; }
	.swatches { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.swatch { width: 2.25rem; height: 2.25rem; border-radius: 50%; border: 2px solid transparent; background: var(--c); outline: 0; box-shadow: inset 0 0 0 2px var(--surface); }
	.swatch.on { border-color: var(--text); }
	.swatch.custom { display: grid; place-items: center; background: var(--raised); color: var(--muted); box-shadow: none; }
	.backdrops { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; }
	.backdrops button { display: grid; gap: 0.35rem; justify-items: center; padding: 0; border: 0; background: none; color: var(--muted); font-size: var(--t-12-8); }
	.backdrops button.on { color: var(--text); font-weight: 700; }
	.tile { display: grid; place-items: center; width: 100%; aspect-ratio: 1; border-radius: 0.6rem; border: 2px solid transparent; background: var(--raised) center / cover; color: var(--muted); }
	.on .tile { border-color: var(--accent); }
	.tile.photo { filter: saturate(1.2); background-size: 300%; }
	.tile.color { background: radial-gradient(circle at 30% 20%, var(--c), color-mix(in srgb, var(--c) 30%, var(--surface))); }
	.tile.plain { background: var(--bg, var(--surface)); box-shadow: inset 0 0 0 1px var(--line); }
	.row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.7rem; min-height: 3rem; }
	.art { width: 2.5rem; border-radius: 0.35rem; overflow: hidden; }
	.glyph { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: 50%; background: var(--raised); color: var(--accent); }
	.copy { display: grid; min-width: 0; }
	.copy strong { font-weight: 600; }
	.copy small { color: var(--muted); font-size: var(--t-12-8); }
	.add { display: inline-flex; align-items: center; gap: 0.4rem; justify-self: start; min-height: 2.5rem; padding: 0 0.9rem; border: 1px dashed var(--faint); border-radius: 999px; background: none; color: var(--text); font-weight: 600; }
	.toggle { grid-template-columns: auto minmax(0, 1fr) auto; cursor: grab; }
	.grip { width: 0.7rem; height: 1.1rem; background: radial-gradient(circle, var(--faint) 1.5px, transparent 1.6px) 0 0 / 0.35rem 0.37rem; }
	.toggle input { appearance: none; box-sizing: content-box; flex: none; width: 2.1rem; height: 1.2rem; border: 1px solid var(--faint); border-radius: 2rem; margin: 0; padding: 0.15rem; background: var(--raised); }
	.toggle input::before { content: ''; display: block; width: 1.2rem; height: 1.2rem; border-radius: 50%; background: var(--muted); }
	.toggle input:checked { background: var(--accent); border-color: var(--accent); }
	.toggle input:checked::before { transform: translateX(0.9rem); background: var(--on-accent); }
	@media (max-width: 1099px) {
		.editor { top: auto; bottom: 0; left: 0; width: auto; max-height: 58dvh; border-left: 0; border-top: 1px solid var(--line); border-radius: 1.1rem 1.1rem 0 0; box-shadow: 0 -1rem 2.5rem rgb(0 0 0 / 0.25); }
		header { border-radius: 1.1rem 1.1rem 0 0; }
	}
</style>
