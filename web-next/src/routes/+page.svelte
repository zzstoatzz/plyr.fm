<script lang="ts">
	import { api, type ChartEntry, type Track } from '$lib/api';
	import TrackRow from '$lib/TrackRow.svelte';
	import { onMount } from 'svelte';

	let tracks = $state<Track[]>([]);
	let cursor = $state<string | null>(null);
	let chart = $state<ChartEntry[]>([]);
	let error = $state<string | null>(null);
	let loading = $state(false);

	async function more() {
		loading = true;
		try {
			const page = await api.tracks({ limit: 30, cursor: cursor ?? undefined });
			tracks = [...tracks, ...page.data];
			cursor = page.has_more ? (page.next_cursor ?? null) : null;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		more();
		api.chart('week').then((c) => (chart = c.data)).catch(() => {});
	});
	const chartTracks = $derived(chart.map((c) => c.track));
</script>

{#if chart.length}
	<h2>top this week</h2>
	<ol class="tracks">
		{#each chart as entry, i (entry.track.id)}
			<TrackRow tracks={chartTracks} index={i} rank={entry.rank} />
		{/each}
	</ol>
{/if}

<h2>latest</h2>
{#if error}<p class="error">{error}</p>{/if}
<ol class="tracks">
	{#each tracks as track, i (track.id)}
		<TrackRow {tracks} index={i} />
	{/each}
</ol>
{#if cursor}
	<button class="btn more" onclick={more} disabled={loading}>{loading ? 'loading…' : 'more'}</button>
{:else if !loading && !tracks.length && !error}
	<p class="muted">nothing here yet.</p>
{/if}
