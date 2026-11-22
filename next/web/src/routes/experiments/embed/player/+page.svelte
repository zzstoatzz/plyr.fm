<script lang="ts">
  import { onMount } from 'svelte';
  import { mountEmbedEvents } from '$lib/embed/events';
  import { createLiveAnalysis } from '$lib/embed/live-analysis';
  import type { EmbedSnapshot } from '@plyr/next-core/embed-events';
  import fixture from '../../../../../static/experiments/embed-analysis.json';
  import '../../../../app.css';

  let audio: HTMLAudioElement;
  let live = $state(false);
  let problem = $state('');
  let tap: ReturnType<typeof createLiveAnalysis> | undefined;
  let stopEvents: (() => void) | undefined;
  let discontinuity = 0;
  let instance = '';
  function snapshot(): EmbedSnapshot {
    return {
      instance, discontinuity, track: null, audioContent: { kind: 'sha256', value: fixture.content.sha256 },
      state: audio.error ? 'error' : audio.seeking ? 'seeking' : audio.ended ? 'ended' : audio.paused ? 'paused' : audio.readyState < 3 ? 'buffering' : 'playing',
      position: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : null,
      rate: audio.playbackRate, visible: document.visibilityState === 'visible'
    };
  }
  async function enableLive() {
    try {
      tap ??= createLiveAnalysis(audio);
      await tap.resume();
      live = true;
    } catch { problem = 'live measurement unavailable; reload to use plain playback.'; }
  }
  onMount(() => {
    instance = crypto.randomUUID();
    stopEvents = mountEmbedEvents(snapshot, () => tap?.read() ?? null);
    return () => { stopEvents?.(); audio.pause(); tap?.close(); };
  });
</script>

<main id="main">
  <audio bind:this={audio} controls src={fixture.content.path} onseeking={() => discontinuity++}>
    <track kind="captions" />
  </audio>
  <label>speed <select onchange={(event) => { audio.playbackRate = Number(event.currentTarget.value); }}>
    <option value="1">1×</option><option value="0.5">0.5×</option><option value="1.5">1.5×</option><option value="2">2×</option>
  </select></label>
  <button onclick={enableLive} disabled={live}>{live ? 'live measurement enabled' : 'enable live comparison'}</button>
  <p>synthetic public fixture · live comparison changes this fixture’s audio routing. reload for plain playback.</p>
  {#if problem}<p role="alert">{problem}</p>{/if}
</main>

<style>
  main { padding: 1rem; background: var(--bg); min-height: 100dvh; }
  audio { width: 100%; }
  label { display: inline-flex; gap: 0.5rem; align-items: center; margin-right: 0.5rem; }
  select, button { font-size: 16px; min-height: 44px; }
  p { font-size: var(--t-13-6); color: var(--muted); }
</style>
