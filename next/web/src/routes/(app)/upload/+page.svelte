<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import AlbumUpload from '$lib/publishing/AlbumUpload.svelte';
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import { albumUploads } from '$lib/storage/upload-storage';
  import { focusClear } from '$lib/ui/focus-clear';
  import Loading from '$lib/ui/Loading.svelte';
  import TrackUpload from '$lib/publishing/TrackUpload.svelte';

  // one page: a single file makes a track, several make an album, and an album upload in progress takes the page until it's done
  const onlyYou = $derived(page.url.searchParams.get('visibility') === 'only-you');
  const albumMode = $derived(page.url.searchParams.get('mode') === 'album');
  const uploadPath = resolve('/(app)/upload');
  let account = $state.raw(auth.getAuth());
  let picked = $state.raw<{ files: File[]; cover?: File }>();
  let checked = $state<string>();
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));

  // an album upload saved on this device reopens here after a reload
  $effect(() => {
    const did = account.did;
    if (!did || checked === did) return;
    checked = did;
    void albumUploads.load(did).then(plan => { if (plan && auth.getAuth().did === did && !albumMode) void goto(uploadPath + '?mode=album', { replaceState: true }); }, () => {});
  });

  async function startAlbum(files: File[], cover?: File) {
    picked = { files, cover };
    await goto(uploadPath + '?mode=album');
  }
  async function startOver() {
    picked = undefined;
    await goto(uploadPath);
  }
</script>

<svelte:head><title>upload · plyr.fm</title></svelte:head>

<section class="page-content" use:focusClear>
  <div class="upload">
    <div class="top"><h1>upload</h1></div>
    {#if !account.ready}
      <Loading label="loading your account" inline />
    {:else if account.did}
      {#key account.rpc}
        {#if albumMode}<AlbumUpload {account} owner={account.did} files={picked?.files} cover={picked?.cover} {startOver} />
        {:else}<TrackUpload {account} {onlyYou} onAlbum={startAlbum} />{/if}
      {/key}
    {:else}
      <a class="text-button" href={resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: uploadPath + page.url.search })}>sign in</a>
    {/if}
  </div>
</section>

<style>
  .upload { --glass: light-dark(rgb(255 255 255 / 0.72), rgb(20 20 20 / 0.66)); display: grid; gap: 1rem; }
  .upload > :global(*) { min-width: 0; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  h1 { font-size: 1.5rem; letter-spacing: -0.02em; }
  :global(.frame.hasPlayer) .upload { --bar-offset: var(--dock); }
  @media (max-width: 720px) {
    .upload { --bar-offset: var(--tabs); }
    :global(.frame.hasPlayer) .upload { --bar-offset: calc(var(--tabs) + var(--dock)); }
  }
</style>
