<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import AlbumCreate from '$lib/collections/AlbumCreate.svelte';
  import EditorPanel from '$lib/catalog/EditorPanel.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

<svelte:head><title>new album · plyr.fm</title></svelte:head>
<section class="page-content">
  {#if account.ready && account.did && account.rpc}
    {#key account.rpc}<AlbumCreate account={{ ...account, did: account.did }} />{/key}
  {:else}
    <EditorPanel title="new album" close="/portal">
      {#if !account.ready}
        <Loading label="loading account" inline />
      {:else}
        <a class="text-button" href="/login?return_to=%2Fcreate-album">sign in</a>
      {/if}
    </EditorPanel>
  {/if}
</section>
