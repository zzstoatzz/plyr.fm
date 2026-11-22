<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { auth } from '$lib/auth';
  import { trackHref } from '$lib/tracks';
  import Icon from '$lib/ui/Icon.svelte';
  import { likes } from './likes';
  import { compactCount } from './format';

  let { track, count = true, named = false }: { track: Track; count?: boolean; named?: boolean } = $props();
  let account = $state.raw(auth.getAuth());
  let snapshot = $state.raw(untrack(() => likes.snapshot(track)));
  const label = $derived((snapshot.liked ? 'Unlike' : 'Like') + (named ? ` ${track.metadata.title}` : ' track'));
  onMount(() => {
    const stop = likes.subscribe(() => { snapshot = likes.snapshot(track); });
    const stopAuth = auth.subscribe(() => { account = auth.getAuth(); });
    return () => { stop(); stopAuth(); };
  });
  $effect(() => { track; account.rpc; snapshot = likes.snapshot(track); void likes.load(track); });
</script>

<span class="like-control" class:liked={snapshot.liked}>
{#if account.ready && account.rpc}
  <button class="icon-button" class:liked={snapshot.liked} type="button" aria-label={label} aria-pressed={snapshot.liked} disabled={snapshot.loading} onclick={() => likes.toggle(track)}><Icon name={snapshot.liked ? 'heart_f' : 'heart'} />{#if count}{compactCount(snapshot.count)}{/if}</button>
{:else}
  <a class="icon-button" href={resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: trackHref(track) })} aria-label={named ? `Sign in to like ${track.metadata.title}` : 'Sign in to like'}><Icon name="heart" />{#if count}{compactCount(snapshot.count)}{/if}</a>
{/if}
{#if snapshot.error}<p role="alert" class="state">{snapshot.error}</p>{/if}
</span>

<style>
  .like-control { position: relative; display: inline-flex; flex: none; }
  .liked { color: var(--accent); }
  .state { position: absolute; z-index: 5; top: 100%; right: 0; width: min(18rem, calc(100vw - 2rem)); background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 0.6rem; padding: 0.6rem; font-size: 0.875rem; }
</style>
