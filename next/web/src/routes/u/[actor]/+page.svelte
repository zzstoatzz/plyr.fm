<script lang="ts">
	import TrackRow from '$lib/TrackRow.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.artist.display_name} · plyr.fm</title></svelte:head>

<section class="page-content">
	<h1>{data.artist.display_name || data.artist.handle}</h1>
	{#if data.artist.bio}<p class="subtle">{data.artist.bio}</p>{/if}
	{#await data.tracks}<Loading label="loading tracks" />
	{:then tracks}
		{#each tracks as track (track.id)}<TrackRow {track} collection={tracks} label={data.artist.display_name} />
		{:else}<p class="state">no tracks yet.</p>{/each}
	{:catch}<p class="state">could not load tracks.</p>{/await}
</section>
