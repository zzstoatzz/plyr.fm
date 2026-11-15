<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	let stats = $state<Awaited<ReturnType<typeof api.stats>>>();
	let loading = $state(true);
	let attempted = $state(false);
	let error = $state(false);
	let request: AbortController | undefined;

	const cards = $derived(stats && [
		{ label: 'plays on Next', value: stats.plays.toLocaleString(), icon: 'play' },
		{ label: 'tracks', value: stats.tracks.toLocaleString(), icon: 'music' },
		{ label: 'artists', value: stats.artists.toLocaleString(), icon: 'user' },
		{ label: 'of audio', value: duration(stats.duration_seconds), icon: 'clock' }
	] as const);

	onMount(() => {
		void refresh();
		return () => request?.abort();
	});

	async function refresh() {
		if (request) return;
		const controller = new AbortController();
		request = controller;
		loading = true;
		error = false;
		try { stats = await api.stats(controller.signal); }
		catch { if (!controller.signal.aborted) error = true; }
		finally { request = undefined; loading = false; attempted = true; }
	}

	function duration(seconds: number) {
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
		if (hours) return `${hours}h ${minutes % 60}m`;
		return `${minutes}m`;
	}
</script>

<svelte:head><title>stats · plyr.fm</title></svelte:head>

<section class="page-content stats">
	<h1>stats</h1>
	{#if loading && !cards}<Loading label="loading stats" />{/if}
	{#if cards}
		<dl class="totals" aria-label="Catalog totals" aria-busy={loading}>
			{#each cards as card (card.label)}
				<div class="card">
					<Icon name={card.icon} size={22} />
					<dt>{card.label}</dt>
					<dd>{card.value}</dd>
				</div>
			{/each}
		</dl>
		<section class="scope" aria-labelledby="stats-scope">
			<h2 id="stats-scope">what counts</h2>
			<p>tracks, artists and audio cover the discoverable catalog on Next, including tracks for supporters.</p>
			<p>plays are qualifying listens counted by Next. audio is the total running time of the catalog.</p>
			{#if stats}
				<p>updated <time datetime={new Date(stats.updated_at_ms).toISOString()}>{new Date(stats.updated_at_ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>. Next caches totals for up to a minute.</p>
			{/if}
		</section>
	{/if}
	{#if error}<p role="alert" class="state">{stats ? 'could not refresh stats.' : 'could not load stats.'}</p>{/if}
	{#if attempted}<button class="text-button refresh" type="button" aria-disabled={loading} onclick={() => void refresh()}>{loading ? 'refreshing…' : error ? 'try again' : 'refresh stats'}</button>{/if}
</section>

<style>
	.stats { max-width: 68rem; }
	h1 { font-size: clamp(1.65rem, 4vw, 2.6rem); letter-spacing: -0.035em; }
	.totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr)); gap: 0.75rem; margin: 1.25rem 0; }
	.card { min-width: 0; display: grid; gap: 0.55rem; border-radius: 0.95rem; padding: clamp(0.9rem, 3vw, 1.3rem); background: var(--surface); border: 1px solid var(--line); color: var(--accent); }
	dt { grid-row: 3; color: var(--muted); }
	dd { margin: 0; color: var(--text); font-weight: 700; font-size: clamp(1.3rem, 5vw, 1.75rem); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
	.scope { max-width: 40rem; display: grid; gap: 0.5rem; }
	h2 { font-size: 1.1rem; }
	.scope p { color: var(--muted); }
	.refresh { margin-top: 1rem; border: 1px solid var(--line); border-radius: 2rem; padding-inline: 1rem; }
	.refresh[aria-disabled="true"] { opacity: 0.6; cursor: wait; }
	@media (max-width: 720px) { .totals { grid-template-columns: repeat(auto-fit, minmax(min(8.5rem, 100%), 1fr)); } }
</style>
