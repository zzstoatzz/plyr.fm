<script lang="ts">
  import { onMount } from 'svelte';
  import { embedPosition, type EmbedEvent } from '@plyr/next-core/embed-events';
  import { matchesAnalysis, type AudioAnalysis } from '@plyr/next-core/audio-analysis';

  let { analysis, snapshot }: { analysis: AudioAnalysis; snapshot: EmbedEvent | undefined } = $props();
  let canvas: HTMLCanvasElement;
  onMount(() => {
    let frame = 0;
    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = '#889899';
        ctx.beginPath();
        for (let i = 0; i < analysis.frames.length; i++) {
          const point = analysis.frames[i];
          const x = i * width / analysis.frames.length;
          ctx.moveTo(x, height / 2 - point.max * height);
          ctx.lineTo(x, height / 2 - point.min * height);
        }
        ctx.stroke();
        if (snapshot && matchesAnalysis(analysis, snapshot)) {
          const now = performance.timeOrigin + performance.now();
          const position = embedPosition(snapshot, (now - snapshot.clock.epochMs) / 1000);
          const duration = analysis.frames.length * analysis.hopSamples / analysis.sampleRate;
          ctx.strokeStyle = '#2ea69a';
          ctx.beginPath(); ctx.moveTo(position / duration * width, 0); ctx.lineTo(position / duration * width, height); ctx.stroke();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  });
</script>
<canvas hidden={!!snapshot && !matchesAnalysis(analysis, snapshot)} bind:this={canvas} width="1000" height="160" aria-label="Precomputed waveform with playback position"></canvas>
{#if snapshot && !matchesAnalysis(analysis, snapshot)}<p>analysis unavailable for this audio revision.</p>{/if}
<style>canvas { width: 100%; height: 160px; }</style>
