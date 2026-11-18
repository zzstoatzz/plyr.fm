<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { MAX_COMMENT_BYTES } from '@plyr/next-core/track-comments';
  import { auth } from '$lib/auth';
  import { player } from '$lib/player.svelte';
  import { clock, trackHref } from '$lib/tracks';
  import Icon from '$lib/ui/Icon.svelte';
  import { comments } from './comments';

  let { track, compact = false }: { track: Track; compact?: boolean } = $props();
  let account = $state.raw(auth.getAuth());
  let enabled = $state(false);
  let draft = $state('');
  let pinned = $state<number>();
  let busy = $state(false);
  let error = $state('');
  let live = false;
  const id = $props.id();
  const position = $derived(!player.liveStation && player.current?.id === track.id ? player.position : 0);
  const seconds = $derived(pinned ?? position);
  const tooLong = $derived(new TextEncoder().encode(draft.trim()).length > MAX_COMMENT_BYTES);
  const signIn = $derived(resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: trackHref(track) }));
  onMount(() => {
    live = true;
    const stop = auth.subscribe(() => {
      const next = auth.getAuth();
      if (next.rpc !== account.rpc) { draft = ''; pinned = undefined; busy = false; error = ''; }
      account = next;
    });
    return () => { live = false; stop(); };
  });
  // Only artists who turned comments on get a composer.
  $effect(() => {
    const id = track.id;
    const update = () => { enabled = comments.snapshot(id).enabled; };
    const unsubscribe = comments.subscribe(id, update);
    update();
    if (!comments.hasLoaded(id)) comments.loadComments(id);
    return unsubscribe;
  });
  async function post() {
    if (!account.commenting || !draft.trim() || busy || tooLong) return;
    const session = account.rpc;
    const target = track;
    const current = () => live && auth.getAuth().rpc === session && track.record.uri === target.record.uri;
    error = '';
    busy = true;
    try {
      await comments.addComment(target, draft.trim(), seconds * 1000);
      if (current()) { draft = ''; pinned = undefined; }
    } catch { if (current()) error = 'could not post your comment. try again.'; }
    finally { if (current()) busy = false; }
  }
</script>

{#if enabled && account.commenting && track.record.cid}
  <form class:compact onsubmit={event => { event.preventDefault(); void post(); }}>
    <label for={id} class:sr-only={compact}>add a comment</label>
    <textarea {id} rows={compact ? 1 : 2} placeholder={compact ? 'say something about this moment…' : undefined} maxlength={MAX_COMMENT_BYTES} bind:value={draft} disabled={busy} oninput={event => { if (event.currentTarget.value.trim()) pinned ??= position; else pinned = undefined; error = ''; }}></textarea>
    <div class="form-actions">
      <button type="button" class="text-button time" title="use the current playback position" onclick={() => { pinned = draft.trim() ? position : undefined; }}>at {clock(seconds)}</button>
      <button type="submit" class="text-button submit" aria-label={compact ? 'Post comment' : undefined} disabled={busy || !draft.trim() || tooLong}>{#if compact}<Icon name={busy ? 'clock' : 'upload'} size={18} />{:else}{busy ? 'posting…' : 'post comment'}{/if}</button>
    </div>
  </form>
{:else if enabled && track.record.cid}
  <a class="sign-in" class:compact href={signIn}>{account.did ? 'reconnect' : 'sign in'} to leave a comment</a>
{/if}
{#if error || tooLong}<p role="alert" class="state">{tooLong ? 'that comment is too long.' : error}</p>{/if}

<style>
  form { display: grid; gap: 0.35rem; }
  textarea { width: 100%; min-height: 4rem; resize: vertical; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 0.65rem; padding: 0.55rem; }
  .form-actions { display: flex; align-items: center; gap: 0.35rem; justify-content: space-between; }
  .time, .sign-in { color: var(--accent); }
  .time { font-variant-numeric: tabular-nums; }
  .submit { background: var(--accent); color: var(--on-accent); font-weight: 650; }
  .submit:disabled { background: var(--raised); color: var(--muted); }
  .compact { border: 1px solid var(--line); border-radius: 1.5rem; padding: 0.15rem 0.3rem 0.15rem 0.75rem; }
  form.compact { display: flex; align-items: center; gap: 0.25rem; }
  .compact textarea { border: 0; padding: 0.5rem 0; flex: 1; min-width: 0; min-height: 2.5rem; max-height: 8rem; resize: vertical; background: transparent; }
  .compact .form-actions { flex: none; }
  .compact .submit { min-width: 2.75rem; }
  .compact .time { padding-inline: 0.35rem; font-size: 0.75rem; white-space: nowrap; }
  .sign-in { display: block; padding: 0.65rem 0.8rem; font-size: 0.875rem; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
