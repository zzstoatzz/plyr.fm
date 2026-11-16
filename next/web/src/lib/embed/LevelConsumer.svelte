<script lang="ts">
  import { onMount } from 'svelte';
  import { embedPosition, type EmbedEvent } from '@plyr/next-core/embed-events';
  import { analysisFrame, matchesAnalysis, type AudioAnalysis } from '@plyr/next-core/audio-analysis';

  let { analysis, snapshot }: { analysis: AudioAnalysis; snapshot: EmbedEvent | undefined } = $props();
  let rms = $state(0);
  let liveRms = $state(0);
  let bands = $state<number[]>([0, 0, 0]);
  onMount(() => {
    let frame = 0;
    const draw = () => {
      const now = performance.timeOrigin + performance.now();
      const active = snapshot && matchesAnalysis(analysis, snapshot) && snapshot.state === 'playing' && snapshot.visible && now - snapshot.clock.epochMs < 500;
      const point = active ? analysisFrame(analysis, embedPosition(snapshot, (now - snapshot.clock.epochMs) / 1000)) : undefined;
      rms = point?.rms ?? 0;
      liveRms = active ? snapshot.analysis?.rms ?? 0 : 0;
      bands = point?.bands ?? [0, 0, 0];
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  });
</script>
{#if snapshot && !matchesAnalysis(analysis, snapshot)}
  <p>analysis unavailable for this audio revision.</p>
{:else}
<div class="levels">
  <label>precomputed RMS <meter min="0" max="1" value={rms}></meter><output>{rms.toFixed(3)}</output></label>
  <label>live RMS <meter min="0" max="1" value={liveRms}></meter><output>{snapshot?.analysis ? liveRms.toFixed(3) : 'unavailable'}</output></label>
  {#each bands as energy, i (i)}
    <label>{analysis.bandsHz[i].join('–')} Hz <meter min="0" max="0.1" value={energy}></meter><output>{energy.toFixed(4)}</output></label>
  {/each}
</div>
{/if}
<style>
  .levels { display: grid; gap: 0.75rem; }
  label { display: grid; grid-template-columns: minmax(8rem, 1fr) 2fr 6rem; align-items: center; gap: 0.5rem; }
  meter { width: 100%; } output { text-align: right; font-variant-numeric: tabular-nums; }
  @media (max-width: 480px) { label { grid-template-columns: 1fr 1fr; } output { grid-column: 2; } }
</style>
