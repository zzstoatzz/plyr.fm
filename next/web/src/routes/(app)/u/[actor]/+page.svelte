<script lang="ts">
	import ArtistView from '$lib/catalog/ArtistView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.artist.display_name || data.artist.handle} · plyr.fm</title></svelte:head>

{#key data.artist.did}
	<ArtistView artist={data.artist} tracks={data.tracks} metrics={data.metrics} />
{/key}
