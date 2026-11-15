<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import Loading from '$lib/ui/Loading.svelte';
  import UploadForm from '$lib/publishing/UploadForm.svelte';

  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

<svelte:head><title>upload · plyr.fm</title></svelte:head>

<section class="page-content">
  <div class="upload">
    <h1>upload</h1>
    <nav aria-label="Upload audience"><span aria-current="page">public</span><a class="text-button" href="/private">private</a></nav>
    {#if !account.ready}
      <Loading label="loading your account" inline />
    {:else if account.did}
      {#key account.rpc}<UploadForm {account} />{/key}
    {:else}
      <a class="text-button" href="/login?return_to=%2Fupload">sign in</a>
    {/if}
  </div>
</section>

<style>
  .upload { max-width: 38rem; display: grid; gap: 0.8rem; }
  nav { display: flex; align-items: center; gap: 0.65rem; }
  nav span { background: var(--hover); border-radius: 0.55rem; padding: 0.65rem 0.8rem; }
</style>
