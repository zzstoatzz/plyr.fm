<script lang="ts">
  import { onMount } from 'svelte';
  import { embedProtocol, parseEmbedEvent, type EmbedEvent } from '@plyr/next-core/embed-events';
  import WaveformConsumer from '$lib/embed/WaveformConsumer.svelte';
  import LevelConsumer from '$lib/embed/LevelConsumer.svelte';
  import fixture from '../../../../static/experiments/embed-analysis.json';
  import '../../../app.css';

  const analysis = { ...fixture, schema: 'fm.plyr.analysis.experimental.v1', timebase: 'seconds', channels: 'mono', normalization: 'none', bandsHz: [[60, 250], [250, 2000], [2000, 7500]] } as const;
  let frame: HTMLIFrameElement;
  let snapshot = $state<EmbedEvent>();
  let subscribed = $state(true);
  let subscription = '';
  function send() {
    if (!subscription) return;
    frame?.contentWindow?.postMessage({ protocol: embedProtocol, type: subscribed ? 'subscribe' : 'unsubscribe', subscription, hz: 10 }, window.location.origin);
  }
  function toggle() { subscribed = !subscribed; snapshot = undefined; send(); }
  onMount(() => {
    subscription = crypto.randomUUID();
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.contentWindow || event.origin !== window.location.origin || !subscribed) return;
      const message = parseEmbedEvent(event.data);
      if (message?.subscription === subscription) snapshot = message;
    };
    window.addEventListener('message', receive);
    send();
    const retry = setInterval(() => { if (subscribed && !snapshot) send(); }, 500);
    return () => { clearInterval(retry); subscribed = false; send(); window.removeEventListener('message', receive); };
  });
</script>
<svelte:head><title>embed experiment · plyr.fm</title></svelte:head>
<main id="main">
  <a href="/">plyr.fm</a>
  <h1>embed experiment</h1>
  <p>Two independent displays follow one player: a waveform and audio levels. This synthetic fixture is public; no account or catalog changes are involved.</p>
  <iframe bind:this={frame} src="/experiments/embed/player" title="Public audio fixture" onload={send} allow="autoplay"></iframe>
  <button onclick={toggle}>{subscribed ? 'unsubscribe displays' : 'subscribe displays'}</button>
  <p role="status">{subscribed ? snapshot?.state ?? 'waiting for player' : 'unsubscribed'} · {snapshot?.position.toFixed(2) ?? '0.00'} s</p>
  <h2>waveform</h2>
  <WaveformConsumer {analysis} {snapshot} />
  <h2>audio levels</h2>
  <LevelConsumer {analysis} {snapshot} />
  <p>Peaks and RMS use unnormalized PCM amplitude. Band levels use squared amplitude. Live FFT windows differ from the precomputed windows; compare timing and trends, not identical numbers.</p>
  <p>Live routing is experimental and limited to this fixture. Mobile background continuity has not been accepted. Normal embeds only report playback events.</p>
</main>
<style>
  main { max-width: 900px; margin: auto; padding: 1.25rem; }
  h1 { font-size: 1.8rem; } h2 { margin-top: 1.5rem; font-size: 1.2rem; }
  p { line-height: 1.6; } iframe { width: 100%; height: 230px; border: 1px solid var(--border); border-radius: 12px; }
  button { min-height: 44px; margin-top: 1rem; font-size: 16px; }
</style>
