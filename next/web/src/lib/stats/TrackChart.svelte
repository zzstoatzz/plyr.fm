<script lang="ts">
	import type { ChartEntry } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { api } from '$lib/api';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	const ranges = [{ key: 'week', label: '7 days' }, { key: 'month', label: '30 days' }, { key: 'all_time', label: 'all time' }] as const;
	let range = $state<(typeof ranges)[number]['key']>('month');
	let retry = $state(0);
	let result = $state.raw<{ range: typeof range; rows: ChartEntry[] } | { range: typeof range; error: true }>();
	const selected = $derived(result?.range === range ? result : undefined);
	const rows = $derived(selected && 'rows' in selected ? selected.rows : undefined);
	const maxLikes = $derived(Math.max(1, ...(rows?.map(row => row.period_like_count) ?? [])));

	$effect(() => {
		retry;
		const period = range;
		result = undefined;
		const request = new AbortController();
		void api.chart(period, 5, request.signal).then(
			({ data }) => { if (!request.signal.aborted) result = { range: period, rows: data }; },
			() => { if (!request.signal.aborted) result = { range: period, error: true }; }
		);
		return () => request.abort();
	});
</script>

<section id="most-liked" aria-labelledby="most-liked-title">
	<header>
		<h2 id="most-liked-title">most liked tracks</h2>
		<div class="ranges" role="group" aria-label="time range for track likes">
			{#each ranges as item (item.key)}
				<button type="button" class="text-button" aria-pressed={range === item.key} onclick={() => { range = item.key; }}>{item.label}</button>
			{/each}
		</div>
	</header>

	{#if !selected}
		<Loading inline label="loading tracks" />
	{:else if 'error' in selected}
		<p role="alert" class="state">couldn’t load the track chart.</p>
		<button type="button" class="text-button" onclick={() => { retry += 1; }}>retry track chart</button>
	{:else if rows?.length}
		<ol class="ranking">
			{#each rows as entry (entry.track.id)}
				<li>
					<span class="cover">
						<Artwork src={trackArtwork(entry.track)} size={42} />
					</span>
					<div class="track">
						<a class="track-title" href={'/track/' + encodeURIComponent(entry.track.id)}>{entry.track.metadata.title}</a>
						<a class="artist" href={'/u/' + encodeURIComponent(entry.track.artist.did)}>{entry.track.artist.profile.display_name || entry.track.artist.profile.handle}</a>
						<div class="bar" aria-hidden="true"><span style:width={(entry.period_like_count / maxLikes * 100) + '%'}></span></div>
					</div>
					<span class="likes">{entry.period_like_count.toLocaleString()} <span class="subtle">{entry.period_like_count === 1 ? 'like' : 'likes'}</span></span>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="state" role="status">no likes in this time range.</p>
	{/if}
</section>

<style>
	header { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem 1rem; flex-wrap: wrap; }
	h2 { font-size: 1.2rem; }
	.ranges { display: flex; flex-wrap: wrap; gap: 0.25rem; }
	.ranges button { padding-inline: 0.7rem; }
	button[aria-pressed='true'] { background: var(--raised); color: var(--accent); box-shadow: inset 0 0 0 1px var(--line); }
	.ranking { list-style: none; padding: 0; margin: 0.35rem 0 0; }
	.ranking li { display: grid; grid-template-columns: 2.625rem minmax(0, 1fr) auto; gap: 0.7rem; align-items: start; padding: 0.7rem 0; border-top: 1px solid var(--line); }
	.cover { border-radius: 0.4rem; overflow: hidden; }
	.track { display: grid; overflow-wrap: anywhere; }
	.track-title { font-weight: 650; }
	.artist { color: var(--muted); font-size: 0.875rem; }
	.likes { white-space: nowrap; font-variant-numeric: tabular-nums; }
	.bar { height: 3px; border-radius: 3px; background: var(--raised); margin-top: 0.5rem; }
	.bar span { display: block; height: 100%; background: var(--accent); border-radius: inherit; }
</style>
