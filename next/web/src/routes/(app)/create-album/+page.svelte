<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { auth } from '$lib/auth';
  import AlbumCreate from '$lib/collections/AlbumCreate.svelte';
  import AlbumJournal from '$lib/collections/AlbumJournal.svelte';
  import { audioAccept } from '$lib/media/accept';
  import AlbumUpload from '$lib/publishing/AlbumUpload.svelte';
  import { albumUploads } from '$lib/storage/upload-storage';
  import { PUBLIC_AUDIO_FORMATS } from '@plyr/next-core/publishing/upload-model';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  // a new album starts from the audio files; tracks already posted are the side path
  let account = $state.raw(auth.getAuth());
  let files = $state.raw<File[]>();
  let posted = $state(false);
  let saved = $state(false);
  let dragging = $state(false);
  let input = $state<HTMLInputElement>();
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));

  // an album already uploading on this device takes the page until it's made
  $effect(() => {
    const did = account.did;
    if (!did) return;
    void albumUploads.load(did).then(plan => { if (auth.getAuth().did === did) saved = !!plan; }, () => {});
  });

  // name order, so a folder's numbered files land as its tracklist
  function take(list: FileList | File[] | undefined | null) {
    const picked = [...(list ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (picked.length) files = picked;
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    take(event.dataTransfer?.files);
  }
</script>

<svelte:head><title>new album · plyr.fm</title></svelte:head>

<section class="page-content">
  <div class="upload">
    <div class="top"><h1>new album</h1></div>
    {#if !account.ready}
      <Loading label="loading your account" inline />
    {:else if !account.did || !account.rpc}
      <a class="text-button" href="/login?return_to=%2Fcreate-album">sign in</a>
    {:else if posted}
      {#key account.rpc}<AlbumCreate account={{ ...account, did: account.did }} back={() => { posted = false; }} />{/key}
    {:else if files || saved}
      {#key account.rpc}<AlbumUpload {account} owner={account.did} {files} startOver={() => { files = undefined; saved = false; }} />{/key}
    {:else}
      {#key account.rpc}<AlbumJournal {account} />{/key}
      <div class="door" class:dragging role="region" aria-label="choose audio files"
        ondragover={event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragging = true; } }}
        ondragleave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dragging = false; }}
        ondrop={drop}>
        <span class="drop-icon"><Icon name="wave" size={34} /></span>
        <h2><span class="wide">drop your audio files here</span><span class="narrow">choose your audio files</span></h2>
        <p class="subtle">select everything in the folder. each file becomes a track, in order.</p>
        <button type="button" class="pill primary" onclick={() => input?.click()}><Icon name="plus" size={18} />choose files</button>
        <p class="formats">{PUBLIC_AUDIO_FORMATS.toLowerCase()} · up to 1.5 GB each</p>
        <input type="file" aria-label="audio files" hidden multiple accept={audioAccept()} bind:this={input} onchange={event => { take(event.currentTarget.files); event.currentTarget.value = ''; }} />
      </div>
      <p class="side">already posted some of it? <button type="button" class="link" onclick={() => { posted = true; }}>add those tracks</button></p>
    {/if}
  </div>
</section>

<style>
  .upload { --glass: light-dark(rgb(255 255 255 / 0.72), rgb(20 20 20 / 0.66)); display: grid; gap: 1rem; }
  .upload > :global(*) { min-width: 0; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  h1 { font-size: 1.5rem; letter-spacing: -0.02em; }
  :global(.frame.hasPlayer) .upload { --bar-offset: var(--dock); }
  .door { display: grid; justify-items: center; align-content: center; gap: 0.8rem; min-height: 22rem; padding: 2rem 1.25rem; text-align: center; border-radius: 1.25rem; border: 2px dashed color-mix(in srgb, var(--accent) 45%, var(--line)); background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%), var(--surface); }
  .door.dragging { outline: 3px solid var(--accent); outline-offset: 4px; }
  .drop-icon { width: 4.5rem; height: 4.5rem; display: grid; place-items: center; border-radius: 1.2rem; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
  .door h2 { font-size: clamp(1.5rem, 3vw, 2rem); letter-spacing: -0.02em; }
  .door .narrow { display: none; }
  .subtle, .formats, .side { color: var(--muted); }
  .formats { font-size: var(--t-13-6); }
  .side { text-align: center; }
  .link { border: 0; padding: 0; background: none; color: var(--accent); font-weight: 700; min-height: 2.75rem; }
  .pill { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-height: 2.75rem; padding: 0 1.35rem; border: 0; border-radius: 999px; background: var(--raised); font-weight: 700; }
  .pill.primary { background: var(--accent); color: var(--on-accent); }
  @media (max-width: 720px) {
    .upload { --bar-offset: var(--tabs); }
    :global(.frame.hasPlayer) .upload { --bar-offset: calc(var(--tabs) + var(--dock)); }
    .door { min-height: 16rem; }
    .door .wide { display: none; }
    .door .narrow { display: inline; }
  }
</style>
