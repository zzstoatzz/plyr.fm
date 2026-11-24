<script lang="ts">
	/** Every sound as a row: its plays, how many tracks it has, and how many plays a track there gets against a typical one. */
	import { pace, type Sound } from './sounds';

	let { sounds, typical, limit = 9 }: { sounds: Sound[]; typical: number; limit?: number } = $props();
	let open = $state(false);
	const rows = $derived(open ? sounds : sounds.slice(0, limit));
	const max = $derived(Math.max(1, ...sounds.map(sound => sound.plays)));
	const note = { above: 'well above average', about: '', below: 'below average' };
</script>

<div class="table" role="table" aria-label="sounds by plays">
	<div class="row head" role="row">
		<span role="columnheader">sound</span><span role="columnheader">plays</span><span role="columnheader" class="num">tracks</span><span role="columnheader">plays per track</span>
	</div>
	{#each rows as sound (sound.id)}
		{@const perTrack = Math.round(sound.plays / sound.tracks)}
		{@const how = pace(sound, typical)}
		<div class="row" role="row">
			<span class="name" role="cell"><b class="truncate">{sound.label}</b><span class="truncate">{sound.artists.join(', ')}</span></span>
			<span class="plays" role="cell"><span class="meter" aria-hidden="true"><i style:width="{(100 * sound.plays) / max}%"></i></span><b>{sound.plays.toLocaleString()}</b></span>
			<span class="num tracks" role="cell">{sound.tracks.toLocaleString()}<span class="phone">{sound.tracks === 1 ? ' track' : ' tracks'}</span></span>
			<span class="pace" class:above={how === 'above'} class:below={how === 'below'} role="cell"><b>{perTrack.toLocaleString()}</b><span class="phone">{' plays each'}</span>{#if note[how]}<span>{` · ${note[how]}`}</span>{/if}</span>
		</div>
	{/each}
</div>
<div class="foot">
	<span>a typical plyr.fm track gets about {Math.round(typical).toLocaleString()} {Math.round(typical) === 1 ? 'play' : 'plays'}.</span>
	{#if sounds.length > limit}<button type="button" class="text-button" aria-expanded={open} onclick={() => { open = !open; }}>{open ? 'fewer sounds' : `all ${sounds.length} sounds`}</button>{/if}
</div>

<style>
	.row { display: grid; grid-template-columns: minmax(0, 18rem) minmax(0, 1fr) 5rem 11rem; gap: 1.25rem; align-items: center; padding-block: 0.65rem; border-bottom: 1px solid var(--line); }
	.head { padding-block: 0.5rem; color: var(--faint); font-size: var(--t-12-8); }
	.num { text-align: right; font-variant-numeric: tabular-nums; }
	.name { display: grid; min-width: 0; }
	.name b { font-size: var(--t-15); }
	.name span { color: var(--faint); font-size: var(--t-12-8); }
	.plays { display: flex; align-items: center; gap: 0.75rem; min-width: 0; font-variant-numeric: tabular-nums; }
	.plays b { min-width: 3.25rem; text-align: right; font-size: var(--t-15); }
	.meter { flex: 1; height: 6px; background: color-mix(in srgb, var(--text) 8%, transparent); }
	.meter i { display: block; height: 100%; background: var(--accent); }
	.tracks { color: var(--muted); }
	.pace { font-size: var(--t-13-6); color: var(--muted); font-variant-numeric: tabular-nums; }
	.pace b { color: var(--text); font-size: var(--t-15); }
	.pace.above, .pace.above b { color: var(--accent); }
	.pace.below span { color: var(--faint); }
	.phone { display: none; }
	.foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem 1rem; margin-top: 0.75rem; color: var(--faint); font-size: var(--t-13-6); }
	@media (max-width: 720px) {
		.head { display: none; }
		.row { grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem 0.75rem; }
		.name, .plays { grid-column: 1 / -1; }
		.tracks { text-align: left; font-size: var(--t-13-6); }
		.phone { display: inline; }
	}
</style>
