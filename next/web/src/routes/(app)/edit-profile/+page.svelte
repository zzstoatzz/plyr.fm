<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import EditorPanel from '$lib/catalog/EditorPanel.svelte';
  import ProfileEditor from '$lib/catalog/ProfileEditor.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

<svelte:head><title>edit profile · plyr.fm</title></svelte:head>

<section class="page-content">
  {#if account.did && account.rpc}
    {#key account.rpc}<ProfileEditor {account} />{/key}
  {:else}
    <EditorPanel title="edit profile" close="/portal">
      {#if account.ready}
        <p class="state">sign in to edit your profile.</p>
        <a class="text-button" href="/login?return_to=%2Fedit-profile" data-sveltekit-replacestate>sign in</a>
      {:else}
        <Loading label="loading account" inline />
      {/if}
    </EditorPanel>
  {/if}
</section>
