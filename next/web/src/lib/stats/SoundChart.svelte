<script lang="ts">
	/** What plyr.fm sounds like: each sound's share of the tracks against its share of the plays. */
	import Artwork from '$lib/ui/Artwork.svelte';
	import { lift, type Sound } from './sounds';

	let { sounds, limit = 9 }: { sounds: Sound[]; limit?: number } = $props();
	let open = $state(false);
	const rows = $derived(open ? sounds : sounds.slice(0, limit));
	const max = $derived(Math.max(0.01, ...sounds.map(sound => Math.max(sound.trackShare, sound.playShare))) * 1.08);
	const tickStep = $derived(max <= 0.3 ? 0.05 : max <= 0.6 ? 0.1 : 0.25);
	const ticks = $derived(Array.from({ length: Math.floor(max / tickStep) + 1 }, (_, i) => i * tickStep));
	/** a share's position along the track, as a percentage, kept clear of the ends */
	const x = (share: number) => `${2 + (share / max) * 96}%`;
	const pct = (share: number) => `${Math.round(share * 100)}%`;
</script>

<div class="sounds">
	<div class="row head" aria-hidden="true">
		<span></span>
		<div class="track"><svg width="100%" height="16">{#each ticks as tick (tick)}<text x={x(tick)} y="12" text-anchor="middle">{pct(tick)}</text>{/each}</svg></div>
		<span></span>
	</div>
	<ol>
		{#each rows as sound (sound.id)}
			{@const a = x(sound.trackShare)}
			{@const b = x(sound.playShare)}
			{@const ratio = lift(sound)}
			<li class="row">
				<div class="who">
					<span class="thumb"><Artwork src={sound.top.thumb || undefined} size={40} /></span>
					<div class="label">
						<b class="truncate">{sound.label}</b>
						<span class="truncate">{sound.artists.join(', ')}</span>
					</div>
				</div>
				<div class="track">
					<svg width="100%" height="22" role="img" aria-label={`${sound.label}: ${pct(sound.trackShare)} of tracks, ${pct(sound.playShare)} of plays`}>
						<line x1="0" x2="100%" y1="11" y2="11" class="rail" />
						<line x1={a} x2={b} y1="11" y2="11" class="span" />
						<circle cx={a} cy="11" r="5" class="tracks" />
						<circle cx={b} cy="11" r="6" class="plays" />
					</svg>
				</div>
				<span class="lift" class:up={ratio >= 1.15}>{ratio.toFixed(1)}× <span class="wide">its share</span></span>
			</li>
		{/each}
	</ol>
	<div class="foot">
		<span class="key"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" class="tracks" /></svg>share of tracks</span>
		<span class="key"><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="6" class="plays" /></svg>share of plays</span>
		{#if sounds.length > limit}<button type="button" class="text-button" aria-expanded={open} onclick={() => { open = !open; }}>{open ? 'fewer sounds' : `all ${sounds.length} sounds`}</button>{/if}
	</div>
</div>

<style>
	ol { list-style: none; margin: 0; padding: 0; }
	.row { display: grid; grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr) 8rem; gap: 1.1rem; align-items: center; }
	li.row { padding-block: 0.55rem; border-top: 1px solid var(--line); }
	.who { display: flex; gap: 0.65rem; align-items: center; min-width: 0; }
	.thumb { flex: none; width: 2.5rem; height: 2.5rem; border-radius: 0.4rem; overflow: hidden; display: block; }
	.label { display: grid; min-width: 0; }
	.label b { font-size: var(--t-15); }
	.label span { color: var(--faint); font-size: var(--t-12-8); }
	.track { min-width: 0; }
	svg { display: block; overflow: visible; }
	text { fill: var(--faint); font-size: var(--t-11-2); font-family: inherit; }
	.rail { stroke: color-mix(in srgb, var(--text) 8%, transparent); }
	.span { stroke: var(--accent); stroke-width: 3; opacity: 0.45; }
	.tracks { fill: var(--bg); stroke: var(--faint); stroke-width: 2; }
	.plays { fill: var(--accent); stroke: var(--bg); stroke-width: 2; }
	.lift { justify-self: end; color: var(--faint); font-size: var(--t-13-6); white-space: nowrap; font-variant-numeric: tabular-nums; }
	.lift.up { color: var(--accent); font-weight: 700; padding: 0.15rem 0.6rem; border-radius: 999px; background: color-mix(in srgb, var(--accent) 16%, transparent); }
	.foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1.1rem; margin-top: 0.6rem; color: var(--faint); font-size: var(--t-13-6); }
	.key { display: inline-flex; align-items: center; gap: 0.35rem; }
	.foot button { margin-left: auto; }
	@media (max-width: 720px) {
		.row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 0.35rem; }
		.head { display: none; }
		.row .track { grid-column: 1 / -1; grid-row: 2; }
		.wide { display: none; }
	}
</style>
