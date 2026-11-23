<script lang="ts">
	import TrackAccess from '$lib/access/TrackAccess.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>who can listen · {data.track.metadata.title} · plyr.fm</title></svelte:head>

{#key data.track.id}<TrackAccess track={data.track} />{/key}
