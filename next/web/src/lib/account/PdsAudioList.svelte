<script lang="ts">
  import type { AudioGap } from '@plyr/next-core/publishing/pds-audio-gaps';
  import { trackIdFromUri } from '@plyr/next-core/record-ids';
  import Artwork from '$lib/ui/Artwork.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { gapReason, gapSize } from '@plyr/next-core/publishing/pds-audio-store';
  import { pdsAudio } from './pds-audio.svelte';

  let { gaps }: { gaps: AudioGap[] } = $props();
</script>

<ul class="gaps">
  {#each gaps as gap (gap.uri)}
    {@const row = pdsAudio.state.rows[gap.uri]}
    <li>
      <span class="thumb"><Artwork src={gap.imageUrl} size={36} /></span>
      <span class="names">
        <b>{gap.title}</b>
        <small>{gapReason(gap)}{#if gap.sizeBytes !== undefined}{' · '}{gapSize(gap.sizeBytes)}{/if}</small>
      </span>
      {#if gap.tooBig || row?.state === 'too-big'}
        <span class="state">stays on plyr.fm</span>
      {:else if row?.state === 'moved'}
        <span class="state ok"><Icon name="check" size={15} />on your PDS</span>
      {:else if row?.state === 'already'}
        <span class="state">nothing to move</span>
      {:else if row?.state === 'moving'}
        <span class="state" role="progressbar" aria-label={`moving ${gap.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.progress * 100)}>
          <span class="bar"><i style:width={`${Math.round(row.progress * 100)}%`}></i></span>{row.progress >= 1 ? 'saving' : `${Math.round(row.progress * 100)}%`}
        </span>
      {:else if row?.state === 'waiting'}
        <span class="state">waiting</span>
      {:else if row?.state === 'no-copy'}
        <a class="state" href={`/edit-track/${trackIdFromUri(gap.uri)}?return_to=%2Fportal`}>replace the audio</a>
      {:else if row?.state === 'failed'}
        <span class="state failed" title={row.error}>didn't move</span>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .gaps { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  li { display: flex; align-items: center; gap: 0.7rem; padding: 0.5rem 0; border-bottom: 1px solid var(--line); }
  li:last-child { border-bottom: 0; }
  .thumb { width: 2.25rem; height: 2.25rem; border-radius: 0.45rem; overflow: hidden; flex: none; }
  .names { flex: 1; min-width: 0; display: grid; }
  .names b { font-size: var(--t-14-4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .names small { color: var(--faint); font-size: var(--t-12-8); }
  .state { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--muted); font-size: var(--t-13-6); white-space: nowrap; flex: none; }
  .state.ok { color: #3fae6a; }
  a.state { color: var(--accent); }
  .bar { width: 5rem; height: 0.25rem; border-radius: 1rem; background: var(--line); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); transition: width 0.2s; }
</style>
