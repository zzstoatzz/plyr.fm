<script lang="ts">
	import ArtistView from '$lib/catalog/ArtistView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.artist.display_name?.trim() || data.artist.handle || data.artist.did} · plyr.fm</title></svelte:head>

{#key data.artist.did}
	<ArtistView artist={data.artist} metrics={data.metrics} />
{/key}
