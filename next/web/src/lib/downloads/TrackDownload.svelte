<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import { toast } from '$lib/toast.svelte';
  import { artistName, trackHref } from '$lib/tracks';
  import Icon from '$lib/ui/Icon.svelte';
  import Sheet from '$lib/ui/Sheet.svelte';
  import { formatAudio } from '@plyr/next-core/downloads/format';
  import { storeName } from '@plyr/next-core/selling';

  // One tap downloads. The sheet opens only when there is something to decide:
  // the artist asks for support, a lossless original exists, or the account needs a grant.
  // `announce` shows progress as a toast, for callers with no button of their own to show it on.
  let { track, busy = $bindable(false), announce = false, onclose }: { track: Track; busy?: boolean; announce?: boolean; onclose?: () => void } = $props();
  type Prepared = Awaited<ReturnType<typeof import('./prepare').prepareTrackDownload>>;
  let sheet: Sheet;
  let choice = $state.raw<Prepared>();
  let needsGrant = $state(false);
  let picked = $state<'playback' | 'original'>();
  let error = $state('');
  let active: AbortController | null = null;
  let account = $state.raw(auth.getAuth());

  function cancel() {
    active?.abort();
    active = null;
    busy = false;
    picked = undefined;
  }
  onMount(() => auth.subscribe(() => {
    const next = auth.getAuth();
    if (next.did !== account.did || next.rpc !== account.rpc) { cancel(); sheet?.close(); }
    account = next;
  }));
  onDestroy(() => active?.abort());

  const signIn = $derived(`${resolve('/(app)/login')}?${new URLSearchParams({ return_to: trackHref(track) })}`);

  /** Starts the download, or opens the sheet when the listener has a choice to make. */
  export function start(): Promise<void> { return run(); }

  async function run(selection?: 'playback' | 'original') {
    if (active) return;
    error = '';
    const current = auth.getAuth();
    if (track.access.download_policy === 'supporters' && !current.supporterDownloads) {
      needsGrant = true;
      sheet.show();
      return;
    }
    const controller = active = new AbortController();
    busy = true;
    picked = selection;
    const progress = announce && !selection ? toast.add('preparing download…', 'info', 60_000) : undefined;
    let flow: typeof import('./prepare') | undefined;
    try {
      flow = await import('./prepare');
      const { prepareTrackDownload, saveDownload } = flow;
      const prepared = await prepareTrackDownload(track, current, controller.signal);
      controller.signal.throwIfAborted();
      if (!selection && (prepared.support || prepared.buy || prepared.original)) { choice = prepared; needsGrant = false; sheet.show(); return; }
      const selected = selection === 'original' ? prepared.original : prepared;
      if (!selected) throw new Error('the original file changed. choose again.');
      await saveDownload(selected, controller.signal);
      if (controller.signal.aborted) return;
      sheet.close();
      toast.add('download started', 'success');
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (!flow) { toast.add('could not start the download. reload the page and try again.', 'error', 6000); return; }
      if (failure instanceof flow.DownloadGrantRequired) { needsGrant = true; sheet.show(); return; }
      const message = failure instanceof Error ? failure.message : 'could not download this track. try again.';
      if (choice) error = message;
      else toast.add(message, 'error', 5000);
    } finally {
      if (progress) toast.dismiss(progress);
      if (active === controller) { active = null; busy = false; picked = undefined; }
    }
  }
</script>

<Sheet bind:this={sheet} title="download" subtitle={track.metadata.title} onclose={() => { cancel(); choice = undefined; needsGrant = false; error = ''; onclose?.(); }}>
  <div class="download">
    {#if needsGrant}
      <p>{account.did ? `${artistName(track)} keeps downloads for supporters. reconnect so plyr.fm can check your support.` : `${artistName(track)} keeps downloads for supporters. sign in so plyr.fm can check your support.`}</p>
      <a class="primary" href={signIn}>{account.did ? 'reconnect' : 'sign in'}</a>
    {:else if choice}
      {#if choice.buy || choice.support}
        <p>{choice.buy ? `${artistName(track)} asks you to consider buying it if you can.` : `${artistName(track)} asks listeners to consider supporting their work.`}</p>
        {#if choice.buy}<a class="primary" href={choice.buy.url} target="_blank" rel="noopener noreferrer">buy · {choice.buy.label}</a>{/if}
        {#if choice.support}<a class={choice.buy ? 'secondary' : 'primary'} href={choice.support} target="_blank" rel="noopener noreferrer">support {artistName(track)} on {storeName(choice.support)}</a>{/if}
      {/if}
      {#if choice.original}
        <button type="button" class="option pick" disabled={busy} onclick={() => run('original')}>
          <span><b>original upload</b><small>{formatAudio(choice.original)}</small></span>
          {#if picked === 'original'}<span class="spin" aria-label="downloading"></span>{:else}<Icon name="download" size={20} />{/if}
        </button>
        <button type="button" class="option" disabled={busy} onclick={() => run('playback')}>
          <span><b>smaller file</b><small>{formatAudio(choice)}</small></span>
          {#if picked === 'playback'}<span class="spin" aria-label="downloading"></span>{:else}<Icon name="download" size={20} />{/if}
        </button>
      {:else}
        <button type="button" class="option pick" disabled={busy} onclick={() => run('playback')}>
          <span><b>continue to download</b><small>{formatAudio(choice)}</small></span>
          {#if picked}<span class="spin" aria-label="downloading"></span>{:else}<Icon name="download" size={20} />{/if}
        </button>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    {/if}
  </div>
</Sheet>

<style>
  .download { display: grid; gap: 0.6rem; padding: 0.2rem 1.25rem 0.4rem; }
  p { margin: 0; color: var(--muted); }
  .primary { display: block; padding: 0.75rem 1rem; border-radius: 0.7rem; background: var(--accent); color: var(--on-accent); font-weight: 650; text-align: center; }
  .primary:hover { text-decoration: none; filter: brightness(1.06); }
  .secondary { display: block; padding: 0.75rem 1rem; border-radius: 0.7rem; border: 1px solid var(--line); color: var(--text); text-align: center; }
  .secondary:hover { text-decoration: none; background: var(--hover); }
  .option { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; width: 100%; min-height: 3.6rem; padding: 0.6rem 0.9rem; border: 1px solid var(--line); border-radius: 0.8rem; background: none; color: var(--muted); text-align: start; }
  .option.pick { border-color: var(--accent); color: var(--accent); }
  .option:hover:not(:disabled) { background: var(--hover); }
  .option span:first-child { display: grid; }
  b { color: var(--text); font-weight: 600; }
  small { color: var(--faint); font-size: 0.82rem; }
  .error { color: var(--text); font-size: 0.875rem; }
  .spin { width: 1.1rem; height: 1.1rem; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
