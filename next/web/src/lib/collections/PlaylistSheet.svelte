<script lang="ts">
  import { onMount } from 'svelte';
  import type { Track } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import Loading from '$lib/ui/Loading.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';

  let { track, onclose }: { track: Track; onclose?: () => void } = $props();
  let sheet: Sheet;
  let busy = $state(false);
  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { const next = auth.getAuth(); if (next.rpc !== account.rpc) sheet?.close(); account = next; }));
  export function show() { sheet.show(); }
</script>

<Sheet bind:this={sheet} title="add to playlist" subtitle={track.metadata.title} {busy} onclose={() => { busy = false; onclose?.(); }}>
  {#if account.rpc && account.did}
    {#key account.rpc}
      {#await import('./PlaylistPicker.svelte')}
        <Loading label="loading playlists" inline />
      {:then { default: Picker }}
        <Picker {account} {track} bind:busy done={() => sheet.close()} />
      {:catch}
        <p class="state" role="alert">could not open your playlists. reload the page and try again.</p>
      {/await}
    {/key}
  {/if}
</Sheet>
