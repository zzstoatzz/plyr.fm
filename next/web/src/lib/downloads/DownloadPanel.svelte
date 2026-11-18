<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { ApiError, type Track } from '@plyr/next-core/api';
  import { prepareDownload } from '@plyr/next-core/downloads/model';
  import { authorizeSupporterDownload, DownloadGrantRequired } from '@plyr/next-core/downloads/supporter';
  import { api } from '$lib/api';
  import { auth } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import { trackHref } from '$lib/tracks';
  import { saveDownload } from './delivery';
  import { prepareProtectedDownload } from './protected';
  import { downloadSession } from './session';

  let { track }: { track: Track } = $props();
  type Choice = Awaited<ReturnType<typeof prepareDownload>>;

  let account = $state.raw(auth.getAuth());
  let busy = $state(false);
  let message = $state('');
  let choice = $state.raw<Choice>();
  let needsGrant = $state(false);
  let active: AbortController | null = null;

  function reset() {
    active?.abort();
    active = null;
    busy = false;
    choice = undefined;
    message = '';
    needsGrant = false;
  }
  onMount(() => auth.subscribe(() => {
    const next = auth.getAuth();
    if (next.did !== account.did || next.rpc !== account.rpc) reset();
    account = next;
  }));
  onDestroy(() => active?.abort());

  function formatAudio(audio: { mime: string; sizeBytes?: number }): string {
    const type = audio.mime.replace(/^audio\//, '').toUpperCase();
    if (!audio.sizeBytes) return type;
    const unit = audio.sizeBytes >= 1_048_576 ? 'MiB' : 'KiB';
    const size = audio.sizeBytes / (unit === 'MiB' ? 1_048_576 : 1024);
    return `${type} · ${size.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
  }

  async function download(selection?: 'playback' | 'original') {
    if (active) return;
    const current = auth.getAuth();
    const controller = active = new AbortController();
    busy = true;
    message = '';
    try {
      const prepared = await prepareDownload(track.id, track.record.uri, {
        track: id => api.track(id, { fresh: true }), artist: api.artist,
        playback: id => api.playback(id, { fresh: true }).catch(error => {
          if (error instanceof ApiError && error.status === 401) throw new Error('this track has no supported download source.');
          throw error;
        }),
        authorize: record => authorizeSupporterDownload(authConfig, current, record, downloadSession(current, controller.signal), controller.signal),
        protected: (latest, uri, admission) => prepareProtectedDownload(latest, uri, current, controller.signal, admission)
      }, controller.signal);
      controller.signal.throwIfAborted();
      if (!selection && (prepared.support || prepared.original)) { choice = prepared; return; }
      if (selection === 'original' && !prepared.original) throw new Error('the original download changed. choose a download again.');
      const selected = selection === 'original' ? prepared.original : prepared;
      if (!selected) throw new Error('the original download is unavailable.');
      choice = undefined;
      await saveDownload(selected, controller.signal);
      if (!controller.signal.aborted) message = 'download started.';
    } catch (error) {
      if (!controller.signal.aborted) {
        choice = undefined;
        needsGrant = error instanceof DownloadGrantRequired;
        message = error instanceof Error ? error.message : 'could not download audio. try again.';
      }
    } finally {
      if (active === controller) active = null;
      if (!controller.signal.aborted) busy = false;
    }
  }

  const signIn = $derived(`${resolve('/(app)/login')}?${new URLSearchParams({ return_to: trackHref(track) })}`);
</script>

<div class="download">
  {#if !account.ready}
    <p class="muted" role="status">checking your account…</p>
  {:else if needsGrant || (track.access.download_policy === 'supporters' && !account.supporterDownloads)}
    <p>{account.did ? 'reconnect to allow supporter download checks.' : 'sign in to check access to this download.'}</p>
    <a class="text-button strong" href={signIn}>{account.did ? 'reconnect for supporter downloads' : 'sign in for supporter downloads'}</a>
  {:else}
    {#if choice}
      {#if choice.support}
        <p>consider supporting this artist before downloading. support is optional.</p>
        <a class="text-button chip" href={choice.support} target="_blank" rel="noopener noreferrer">support artist</a>
      {/if}
      {#if choice.original}
        <p>choose the listening version or the original uploaded file.</p>
        <button class="text-button chip" type="button" disabled={busy} onclick={() => download('playback')}>playback audio · {formatAudio(choice)}</button>
        <button class="text-button chip strong" type="button" disabled={busy} onclick={() => download('original')}>original upload · {formatAudio(choice.original)}</button>
      {:else}
        <button class="text-button chip strong" type="button" disabled={busy} onclick={() => download('playback')}>continue download</button>
      {/if}
      {#if !busy}<button class="text-button" type="button" onclick={() => { choice = undefined; }}>cancel</button>{/if}
    {:else}
      <button class="text-button chip strong" type="button" disabled={busy} onclick={() => download()}>{busy ? 'preparing download…' : 'download audio'}</button>
    {/if}
    {#if busy}<button class="text-button" type="button" onclick={reset}>cancel download</button>{/if}
  {/if}
  <p class="status" role="status">{message}</p>
</div>

<style>
  .download { display: grid; gap: 0.6rem; justify-items: start; }
  p { margin: 0; }
  .status, .muted { color: var(--muted); }
  .status:empty { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .chip { border: 1px solid var(--line); border-radius: 2rem; }
  .strong { color: var(--accent); font-weight: 620; }
</style>
