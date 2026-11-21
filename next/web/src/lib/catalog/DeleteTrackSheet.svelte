<script lang="ts">
  import type { Track } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import { createPds } from '$lib/pds';
  import { toast } from '$lib/toast.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';

  // The confirm for deleting a track from a list; the editor keeps its own inline confirm.
  let { ondeleted }: { ondeleted: (track: Track) => void } = $props();
  let sheet: Sheet;
  let track = $state<Track>();
  let busy = $state(false);
  let failure = $state('');

  export function open(next: Track) { track = next; failure = ''; sheet.show(); }

  async function remove() {
    if (!track || busy) return;
    const target = track;
    busy = true; failure = '';
    try {
      await createPds(auth.getAuth()).deleteTrack(target.record.uri);
      toast.add(`deleted "${target.metadata.title}"`, 'success');
      ondeleted(target);
      busy = false;
      sheet.close();
    } catch (error) {
      failure = error instanceof Error ? error.message : 'could not delete this track. try again.';
      busy = false;
    }
  }
</script>

<Sheet bind:this={sheet} title="delete track?" subtitle={track?.metadata.title} {busy}>
  <div class="confirm">
    <p>“{track?.metadata.title}” comes off your profile and plyr.fm, along with its likes and plays. keep your original file: this can't be undone.</p>
    {#if failure}<p role="alert" class="failure">{failure}</p>{/if}
    <div class="actions">
      <button type="button" class="text-button" disabled={busy} onclick={remove}>{busy ? 'deleting…' : 'delete track'}</button>
      <button type="button" class="text-button" disabled={busy} onclick={() => sheet.close()}>keep it</button>
    </div>
  </div>
</Sheet>

<style>
  .confirm { display: grid; gap: 0.75rem; padding: 0 1rem 1rem; }
  .confirm p { margin: 0; color: var(--muted); }
  .confirm .failure { color: var(--text); }
  .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
</style>
