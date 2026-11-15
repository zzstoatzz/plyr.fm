<script lang="ts">
  import type { ListSummary } from '@plyr/next-core/api';
  import { collectionArtwork } from '@plyr/next-core/artwork';
  import { blobUrl } from '@plyr/next-core/identity';
  import Artwork from '$lib/ui/Artwork.svelte';

  let { list, size, eager = false }: { list: ListSummary; size: number; eager?: boolean } = $props();
  let owned = $state<string>();
  const fallback = $derived(collectionArtwork(list));

  $effect(() => {
    const cid = list.metadata.cover_blob_cid;
    const did = list.owner.did;
    owned = undefined;
    if (!cid) return;
    let live = true;
    void blobUrl(did, cid).then(url => { if (live) owned = url; }).catch(() => {});
    return () => { live = false; };
  });
</script>

<Artwork src={owned ?? fallback} fallback={fallback === owned ? undefined : fallback} {size} {eager} />
