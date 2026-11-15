<script lang="ts">
  import TrackEmbed from '$lib/embed/TrackEmbed.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.track.metadata.title} · plyr.fm</title></svelte:head>
{#key data.track.id}<TrackEmbed track={data.track} autoplay={data.autoplay} />{/key}
