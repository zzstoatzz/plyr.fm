<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import AlbumUpload from '$lib/publishing/AlbumUpload.svelte';
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';
  import TrackUpload from '$lib/publishing/TrackUpload.svelte';

  const onlyYou = $derived(page.url.searchParams.get('visibility') === 'only-you');
  const albumMode = $derived(page.url.searchParams.get('mode') === 'album');
  const uploadPath = resolve('/(app)/upload');
  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
</script>

<svelte:head><title>upload · plyr.fm</title></svelte:head>

<section class="page-content">
  <div class="upload" class:album={albumMode}>
    <div class="top">
      <h1>{albumMode ? 'upload album' : 'upload'}</h1>
      <nav aria-label="Upload type">
        {#if albumMode}<a href={uploadPath}><Icon name="music" size={16} />track</a><span aria-current="page"><Icon name="disc" size={16} />album</span>
        {:else}<span aria-current="page"><Icon name="music" size={16} />track</span><a href={uploadPath + '?mode=album'}><Icon name="disc" size={16} />album</a>{/if}
      </nav>
    </div>
    {#if !account.ready}
      <Loading label="loading your account" inline />
    {:else if account.did}
      {#key account.rpc}
        {#if albumMode}<AlbumUpload {account} owner={account.did} />
        {:else}<TrackUpload {account} {onlyYou} />{/if}
      {/key}
    {:else}
      <a class="text-button" href={resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: uploadPath + page.url.search })}>sign in</a>
    {/if}
  </div>
</section>

<style>
  .upload { --glass: light-dark(rgb(255 255 255 / 0.72), rgb(20 20 20 / 0.66)); max-width: 72rem; display: grid; gap: 1rem; }
  .upload.album { max-width: 38rem; }
  .upload > :global(*) { min-width: 0; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  h1 { font-size: 1.5rem; letter-spacing: -0.02em; }
  nav { display: inline-flex; gap: 0.15rem; padding: 0.25rem; border-radius: 999px; background: var(--raised); border: 1px solid var(--line); }
  nav :is(a, span) { display: inline-flex; align-items: center; gap: 0.4rem; min-height: 2.25rem; padding: 0 0.95rem; border-radius: 999px; color: var(--muted); font-size: 0.9rem; font-weight: 600; }
  nav a:hover { text-decoration: none; color: var(--text); }
  nav span { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgb(0 0 0 / 0.14); }
  :global(.frame.hasPlayer) .upload { --bar-offset: var(--dock); }
  @media (max-width: 720px) {
    .upload { --bar-offset: calc(var(--tabs) + env(safe-area-inset-bottom)); }
    :global(.frame.hasPlayer) .upload { --bar-offset: calc(var(--tabs) + var(--dock) + env(safe-area-inset-bottom)); }
  }
</style>
