<script lang="ts">
  import CatalogEmbed from '$lib/embed/CatalogEmbed.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.catalog.title} · plyr.fm</title></svelte:head>
<CatalogEmbed data={data.catalog} />
