<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { auth } from '$lib/auth';
  import EditorPanel from '$lib/catalog/EditorPanel.svelte';
  import TrackEditor from '$lib/catalog/TrackEditor.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let account = $state.raw(auth.getAuth());
  const id = $derived(page.params.id ?? '');
  const returnTo = $derived(page.url.searchParams.get('return_to') === '/portal' ? '/portal' : undefined);
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

<svelte:head><title>edit track · plyr.fm</title></svelte:head>

<section class="page-content">
  {#key id}
    {#if account.did && account.rpc}
      {#key account.rpc}<TrackEditor {account} {id} {returnTo} />{/key}
    {:else}
      <EditorPanel title="edit track" close={returnTo ?? `/track/${encodeURIComponent(id)}`}>
        {#if account.ready}
          <p class="state">sign in to edit your track.</p>
          <a class="text-button" href={'/login?' + new URLSearchParams({ return_to: page.url.pathname + page.url.search })} data-sveltekit-replacestate>sign in</a>
        {:else}
          <Loading label="loading account" inline />
        {/if}
      </EditorPanel>
    {/if}
  {/key}
</section>
