<script lang="ts">
  import type { ListSummary } from '@plyr/next-core/api';
  import { api } from '$lib/api';
  import PagedListing from '$lib/catalog/PagedListing.svelte';
  import ListCards from '$lib/collections/ListCards.svelte';
</script>

<svelte:head><title>playlists · plyr.fm</title></svelte:head>
<section class="page-content">
  <h1>playlists</h1>
  <PagedListing load={cursor => api.playlists({ cursor, limit: 30 })} label="playlists" empty="no playlists yet." key="playlists">
    {#snippet items(lists: ListSummary[])}<ListCards {lists} />{/snippet}
  </PagedListing>
</section>
