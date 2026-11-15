<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import Icon from '$lib/ui/Icon.svelte';
  import Loading from '$lib/ui/Loading.svelte';

  let { track, transport, compact = false, onNavigate }: { track: Track; transport: Snippet; compact?: boolean; onNavigate?: () => void } = $props();
  let account = $state.raw(auth.getAuth());
  let picking = $state(false);
  let liked = $state(false);
  let initialLike = $state(false);
  let loading = $state(false);
  let busy = $state(false);
  let error = $state('');
  let confirmed = $state(false);
  let live = false;
  const returnTo = $derived(resolve('/(app)/track/[id]', { id: track.id }));
  const signIn = $derived(resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: returnTo }));
  const count = $derived(track.metrics.like_count + Number(liked) - Number(initialLike));

  onMount(() => {
    live = true;
    const stop = auth.subscribe(() => {
      const next = auth.getAuth();
      if (account.rpc !== next.rpc) {
        picking = liked = initialLike = busy = confirmed = false;
        error = '';
      }
      account = next;
    });
    return () => { live = false; stop(); };
  });

  $effect(() => {
    const session = account.rpc;
    const uri = track.record.uri;
    if (!session) return;
    let current = true;
    loading = true;
    confirmed = false;
    void import('$lib/pds').then(async ({ createPds }) => {
      if (!current) return;
      const likes = await createPds(account).myLikes();
      if (current) { liked = initialLike = likes.has(uri); confirmed = true; }
    }).catch(() => {
      if (current) error = 'could not load your like. try again.';
    }).finally(() => { if (current) loading = false; });
    return () => { current = false; };
  });

  async function toggle() {
    if (!account.rpc || busy || loading) return;
    const session = account;
    const playing = track;
    const current = () => live && auth.getAuth().rpc === session.rpc && track.record.uri === playing.record.uri;
    busy = true;
    error = '';
    try {
      const { createPds } = await import('$lib/pds');
      if (!current()) return;
      const pds = createPds(session);
      const hadLike = confirmed ? liked : (await pds.myLikes()).has(playing.record.uri);
      if (!current()) return;
      if (!confirmed) initialLike = hadLike;
      if (hadLike) await pds.unlike(playing, { waitForIndex: false });
      else await pds.like(playing, { waitForIndex: false });
      if (current()) { liked = !hadLike; confirmed = true; }
    } catch (failure) {
      if (current()) error = failure instanceof Error ? failure.message : 'could not update this like.';
    } finally { if (current()) busy = false; }
  }
</script>

<div class="actions" class:compact>
  {#if account.ready && account.rpc}
    <button class="icon-button" type="button" aria-label={liked ? 'Unlike track' : 'Like track'} aria-pressed={liked} disabled={loading || busy} onclick={toggle}><Icon name={liked ? 'heart_f' : 'heart'} />{Math.max(0, count)}</button>
  {:else}
    <a class="icon-button" href={signIn} aria-label="Sign in to like" onclick={onNavigate}><Icon name="heart" />{track.metrics.like_count}</a>
  {/if}
  {@render transport()}
</div>
{#if !compact && account.ready && account.rpc}
  <div class="actions">
    <button class="text-button" type="button" aria-expanded={picking} onclick={() => { picking = !picking; }}>add to playlist</button>
    {#if account.did === track.artist.did}<a class="text-button" href={resolve('/(app)/edit-track/[id]', { id: track.id })}>edit track</a>{/if}
  </div>
{/if}
{#if error}<p role="alert" class="state">{error}</p>{/if}
{#if picking && account.did && account.rpc}
  {#key account.rpc}
    {#await import('./PlaylistPicker.svelte')}
      <Loading label="loading playlists" inline />
    {:then picker}
      <picker.default {account} {track} />
    {:catch}
      <p role="alert" class="state">could not open your playlists.</p>
    {/await}
  {/key}
{/if}

<style>
  .actions { display: flex; align-items: center; justify-content: center; gap: 0.5rem; flex-wrap: wrap; }
  .compact { justify-content: space-between; }
</style>
