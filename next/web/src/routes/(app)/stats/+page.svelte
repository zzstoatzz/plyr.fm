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
				<span class="aside">all time{#if artist}{' · '}<a href={resolve('/(app)/u/[actor]', { actor: artist.did })}>artist page</a>{/if}</span>
			{:else}
				<nav class="ranges" aria-label="time range">
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
	header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 1rem 1.5rem; margin-bottom: 2.25rem; }
	.controls { display: flex; align-items: baseline; gap: 0.75rem; padding-bottom: 0.35rem; }
	.ranges { display: flex; gap: 1.4rem; }
	.ranges a { color: var(--faint); font-size: var(--t-16); white-space: nowrap; padding-block: 0.3rem; text-underline-offset: 0.45rem; text-decoration-thickness: 2px; }
	.ranges a:hover { color: var(--text); }
	.ranges a.on { color: var(--text); font-weight: 700; text-decoration-line: underline; text-decoration-color: var(--accent); }
	.aside { color: var(--faint); font-size: var(--t-15); }
	.aside a { color: var(--accent); }
	@media (max-width: 720px) {
		header { margin-bottom: 1.75rem; }
		.controls { width: 100%; }
		.ranges { flex: 1; justify-content: space-between; }
	}
</style>
