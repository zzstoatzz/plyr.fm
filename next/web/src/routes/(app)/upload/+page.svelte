<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import AlbumUpload from '$lib/publishing/AlbumUpload.svelte';
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import Loading from '$lib/ui/Loading.svelte';
  import UploadForm from '$lib/publishing/UploadForm.svelte';

  const albumMode = $derived(page.url.searchParams.get('mode') === 'album');
  const uploadPath = resolve('/(app)/upload');
  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

<svelte:head><title>upload · plyr.fm</title></svelte:head>

<section class="page-content">
  <div class="upload">
    <h1>{albumMode ? 'upload album' : 'upload'}</h1>
    <nav aria-label="Upload audience"><span aria-current="page">public</span><a class="text-button" href="/private">private</a></nav>
    <nav aria-label="Upload type">
      {#if albumMode}<a class="text-button" href={uploadPath}>track</a><span aria-current="page">album</span>
      {:else}<span aria-current="page">track</span><a class="text-button" href={uploadPath + '?mode=album'}>album</a>{/if}
    </nav>
    {#if !account.ready}
      <Loading label="loading your account" inline />
    {:else if account.did}
      {#key account.rpc}
        {#if albumMode}<AlbumUpload {account} owner={account.did} />
        {:else}<UploadForm {account} />{/if}
      {/key}
    {:else}
      <a class="text-button" href={resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: uploadPath + (albumMode ? '?mode=album' : '') })}>sign in</a>
    {/if}
  </div>
</section>

<style>
  .upload { max-width: 38rem; display: grid; gap: 0.8rem; }
  nav { display: flex; align-items: center; gap: 0.65rem; }
  nav span { background: var(--hover); border-radius: 0.55rem; padding: 0.65rem 0.8rem; }
</style>
