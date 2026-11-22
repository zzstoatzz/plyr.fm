<script lang="ts">
	import { resolve } from '$app/paths';
	import { trackHref } from '$lib/tracks';
	import type { ChartEntry } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { api } from '$lib/api';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	const ranges = [{ key: 'week', label: '7 days' }, { key: 'month', label: '30 days' }, { key: 'all_time', label: 'all time' }] as const;
	let range = $state<(typeof ranges)[number]['key']>('month');
	let retry = $state(0);
	let retrying = $state(false);
	let retryButton = $state<HTMLButtonElement>();
	let rangesGroup: HTMLDivElement;
	let result = $state.raw<{ range: typeof range; rows: ChartEntry[] } | { range: typeof range; error: true }>();
	const selected = $derived(result?.range === range ? result : undefined);
	const rows = $derived(selected && 'rows' in selected ? selected.rows : undefined);
	const maxLikes = $derived(Math.max(1, ...(rows?.map(row => row.period_like_count) ?? [])));

	$effect(() => {
		retry;
		const period = range;

		const request = new AbortController();
		void api.chart(period, 5, request.signal).then(
			({ data }) => {
				if (request.signal.aborted) return;
				if (retryButton && document.activeElement === retryButton) {
					rangesGroup.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
				}
				retrying = false;
				result = { range: period, rows: data };
			},
			() => {
				if (request.signal.aborted) return;
				retrying = false;
				result = { range: period, error: true };
			}
		);
		return () => request.abort();
	});
</script>

<section id="most-liked" tabindex="-1" aria-labelledby="most-liked-title">
	<header>
		<h2 id="most-liked-title">most liked tracks</h2>
		<div class="ranges" bind:this={rangesGroup} role="group" aria-label="time range for track likes">
			{#each ranges as item (item.key)}
				<button type="button" class="text-button" aria-pressed={range === item.key} onclick={() => { if (range !== item.key) { range = item.key; retrying = false; result = undefined; } }}>{item.label}</button>
			{/each}
		</div>
	</header>

	{#if !selected}
		<Loading inline label="loading tracks" />
	{:else if 'error' in selected}
		<p role="alert" class="state">couldn’t load the track chart.</p>
		<button type="button" class="text-button" bind:this={retryButton} aria-disabled={retrying}
			onclick={() => { if (!retrying) { retrying = true; retry += 1; } }}>{retrying ? 'retrying…' : 'retry track chart'}</button>
	{:else if rows?.length}
		<ol class="ranking" role="list">
			{#each rows as entry (entry.track.id)}
				<li value={entry.rank}>
					<span class="rank" aria-hidden="true">{entry.rank}</span>
					<span class="cover">
						<Artwork src={trackArtwork(entry.track)} size={42} />
					</span>
					<div class="track">
						<a class="track-title" href={trackHref(entry.track)}>{entry.track.metadata.title}</a>
						<a class="artist" href={resolve('/(app)/u/[actor]', { actor: entry.track.artist.did })}>{entry.track.artist.profile.display_name || entry.track.artist.profile.handle}</a>
						<div class="bar" aria-hidden="true"><span style:width={(entry.period_like_count / maxLikes * 100) + '%'}></span></div>
					</div>
					<span class="likes"><strong>{entry.period_like_count.toLocaleString()}</strong> <span>{entry.period_like_count === 1 ? 'like' : 'likes'}</span></span>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="state" role="status">no likes in this time range.</p>
	{/if}
</section>

<style>
	section:focus { outline: none; }
	section { min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 1rem; }
	header { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem 1rem; flex-wrap: wrap; padding: 1rem; }
	h2 { font-size: 1.2rem; }
	.ranges { display: flex; flex-wrap: wrap; gap: 0.2rem; }
	.ranges button { padding-inline: 0.65rem; color: var(--muted); }
	.ranges button[aria-pressed='true'] { background: color-mix(in srgb, var(--accent) 9%, var(--raised)); color: var(--accent); box-shadow: inset 0 0 0 1px var(--line); }
	.ranking { list-style: none; padding: 0; margin: 0; }
	.ranking li { display: grid; grid-template-columns: 1.25rem 2.625rem minmax(0, 1fr) auto; gap: 0.65rem; align-items: center; padding: 0.75rem 1rem; border-top: 1px solid var(--line); }
	.rank { color: var(--muted); font-size: var(--t-13-6); text-align: center; font-variant-numeric: tabular-nums; }
	.cover { border-radius: 0.4rem; overflow: hidden; }
	.track { display: grid; justify-items: start; min-width: 0; overflow-wrap: anywhere; }
	.track-title { font-weight: 650; }
	.artist { color: var(--muted); font-size: var(--t-14); }
	.likes { display: grid; text-align: right; line-height: 1.25; font-variant-numeric: tabular-nums; }
	.likes strong { font-size: 1.2rem; }
	.likes span { color: var(--muted); font-size: var(--t-12); }
	.bar { width: 100%; height: 3px; border-radius: 3px; background: var(--raised); margin-top: 0.45rem; }
	.bar span { display: block; height: 100%; background: var(--accent); border-radius: inherit; }
	.state { margin: 0; padding: 0.8rem 1rem; }
	section > button { margin: 0 1rem 1rem; }
	@media (max-width: 395px) {
		.ranges button { font-size: var(--t-14); padding-inline: 0.55rem; }
		.ranking li { gap: 0.45rem; padding-inline: 0.65rem; }
	}
</style>
