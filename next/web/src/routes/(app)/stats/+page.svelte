<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Artist } from '@plyr/next-core/api';
	import ArtistStats from '$lib/stats/ArtistStats.svelte';
	import Overview from '$lib/stats/Overview.svelte';
	import ScopePicker from '$lib/stats/ScopePicker.svelte';
	import { parseRange, ranges } from '$lib/stats/ranges';

	const actor = $derived(page.url.searchParams.get('artist')?.trim().replace(/^@/, '') || undefined);
	const range = $derived(parseRange(page.url.searchParams.get('range')));
	let artist = $state.raw<Artist>();
	const title = $derived(actor ? `${artist ? artist.display_name || artist.handle : actor} · stats · plyr.fm` : 'stats · plyr.fm');
</script>

<svelte:head><title>{title}</title></svelte:head>

<article class="page-content stats immersive">
	<header>
		<ScopePicker artist={actor ? artist : undefined} />
		<div class="controls">
			{#if actor}
				{#if artist}<a class="text-button" href={resolve('/(app)/u/[actor]', { actor: artist.did })}>artist page</a>{/if}
				<span class="chips" aria-label="time range"><span class="on">all time</span></span>
			{:else}
				<nav class="chips" aria-label="time range">
					{#each ranges as option (option.value)}
						<a href={resolve(option.value === 'month' ? '/stats' : `/stats?range=${option.value}`)} class:on={option.value === range}
							aria-current={option.value === range ? 'page' : undefined} data-sveltekit-noscroll data-sveltekit-replacestate>{option.label}</a>
					{/each}
				</nav>
			{/if}
		</div>
	</header>
	{#if actor}
		{#key actor}<ArtistStats {actor} onartist={value => { artist = value; }} />{/key}
	{:else}
		<Overview {range} />
	{/if}
</article>

<style>
	.stats { position: relative; isolation: isolate; max-width: none; }
	header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem 1.5rem; margin-bottom: 2rem; }
	.controls { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
	.chips { display: flex; gap: 0.25rem; padding: 0.2rem; border: 1px solid var(--line); border-radius: 999px; background: color-mix(in srgb, var(--surface) 70%, transparent); }
	.chips a, .chips span { display: inline-flex; align-items: center; min-height: 2.25rem; padding: 0 0.85rem; border-radius: 999px; color: var(--muted); font-size: var(--t-14); white-space: nowrap; }
	.chips a:hover { color: var(--text); }
	.chips .on { background: var(--text); color: var(--bg); font-weight: 700; }
	@media (max-width: 720px) {
		header { margin-bottom: 1.5rem; }
		.controls { width: 100%; }
		nav.chips { flex: 1; justify-content: space-between; }
	}
</style>
