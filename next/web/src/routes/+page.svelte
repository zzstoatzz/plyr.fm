<script lang="ts">
	import { api, type ChartEntry, type Track } from '$lib/api';
	import TrackRow from '$lib/TrackRow.svelte';
	import Icon from '$lib/ui/Icon.svelte';
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
		api.chart('week').then((c) => (chart = c.data.slice(0, 5))).catch(() => {});
	});
	const chartTracks = $derived(chart.map((c) => c.track));
</script>

<header class="home-head">
	<a class="brand plain" href="/">plyr.fm <span class="tag">next</span></a>
	<a class="btn ghost icon" href="/settings" aria-label="settings"><Icon name="settings" /></a>
</header>

{#if chart.length}
	<h2 class="section">top this week</h2>
	<ol class="plain">
		{#each chart as entry, i (entry.track.id)}
			<TrackRow tracks={chartTracks} index={i} rank={entry.rank} />
		{/each}
	</ol>
{/if}

<h2 class="section">latest</h2>
{#if error}<p class="error pad">{error}</p>{/if}
<ol class="plain">
	{#each tracks as track, i (track.id)}
		<TrackRow {tracks} index={i} />
	{/each}
</ol>
{#if loading && !tracks.length}
	<p class="empty">loading…</p>
{:else if error && !tracks.length}
	<div class="pad center"><button class="btn" onclick={() => ((error = null), more())}>retry</button></div>
{/if}
{#if cursor}
	<div class="pad center"><button class="btn outline" onclick={more} disabled={loading}>{loading ? 'loading…' : 'more'}</button></div>
{:else if !loading && !tracks.length && !error}
	<p class="empty">nothing here yet.</p>
{/if}

<style>
	.home-head {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 52px;
		padding: var(--s-xs) var(--s-sm) var(--s-xs) var(--s-lg);
		padding-top: max(var(--s-xs), env(safe-area-inset-top));
		background: color-mix(in srgb, var(--c-0) 88%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--c-50);
	}
	.brand {
		font-size: var(--t-xl);
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.tag {
		font-size: var(--t-xs);
		font-weight: 700;
		color: var(--accent);
		vertical-align: super;
	}
	.center {
		display: flex;
		justify-content: center;
	}
	@media (min-width: 800px) {
		.home-head {
			display: none;
		}
	}
</style>
