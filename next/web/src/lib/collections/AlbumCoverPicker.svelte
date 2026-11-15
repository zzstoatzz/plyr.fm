<script lang="ts">
  import { ARTWORK_EDGE } from '@plyr/next-core/publishing/artwork-model';
  import { onDestroy } from 'svelte';
  import { coverImage } from '$lib/media/cover-image';

  let { file = $bindable(), pending = $bindable(), disabled, editing = false }: {
    file: File | undefined;
    pending: boolean;
    disabled: boolean;
    editing?: boolean;
  } = $props();
  let error = $state('');
  let input = $state<HTMLInputElement>();
  let preview = $state<string>();
  let generation = 0;
  onDestroy(() => { generation += 1; });
  $effect(() => {
    const url = file && URL.createObjectURL(file);
    preview = url;
    if (url) return () => URL.revokeObjectURL(url);
  });

  async function choose(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget;
    const picked = input.files?.[0];
    if (!picked) return;
    const attempt = ++generation;
    pending = true;
    error = '';
    try {
      const image = await coverImage(picked, ARTWORK_EDGE);
      if (attempt === generation) file = image;
    } catch {
      if (attempt !== generation) return;
      error = 'could not open this image. choose a different photo.';
      file = undefined;
      input.value = '';
    } finally {
      if (attempt === generation) pending = false;
    }
  }
  function clear() {
    generation += 1;
    pending = false;
    file = undefined;
    error = '';
    if (input) { input.value = ''; input.focus(); }
  }
</script>

<label>
  {editing ? 'change album cover' : 'cover art (optional)'}
  <input type="file" accept="image/*,.heic,.heif" bind:this={input} {disabled} onchange={choose} />
</label>
{#if preview}
  <div class="preview">
    <img src={preview} alt="selected cover preview" width="64" height="64" />
    <button type="button" class="text-button" {disabled} onclick={clear}>{editing ? 'keep current cover' : 'remove cover'}</button>
  </div>
{/if}
{#if error}<p role="alert">{error}</p>{/if}

<style>
  input { display: block; width: 100%; min-width: 0; color: var(--text); font: inherit; }
  input::file-selector-button {
    min-height: 44px;
    margin-inline-end: 0.65rem;
    padding-inline: 0.7rem;
    font: inherit;
    color: inherit;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 0.55rem;
  }
  .preview { display: flex; align-items: center; gap: 0.65rem; }
  img { display: block; border-radius: 0.45rem; object-fit: cover; }
</style>
