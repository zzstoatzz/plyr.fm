<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Track } from '@plyr/next-core/api';
  import { describePolicy, describeRule, implicitRule, isOpen, parsePrice, trackSpace, type Policy, type Rule } from '@plyr/next-core/access/policy';
  import { listPolicies, memberDid } from '@plyr/next-core/access/policy-read';
  import { resolve } from '$app/paths';
  import { auth } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import { toast } from '$lib/toast.svelte';
  import Icon from '$lib/ui/Icon.svelte';
  import { addPolicy, removePolicy, trackAccess } from './pds';

  type Subject = { noun: string; tracks: Track[]; skey: string };
  let { subject, returnTo, onchange }: { subject: Subject; returnTo: string; onchange?: () => void } = $props();
  const CURRENCY = 'USD';
  const config = { policyCollection: authConfig.NSID.policy, audioSpaceType: authConfig.AUDIO_SPACE_TYPE };

  let account = $state.raw(auth.getAuth());
  onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
  const owned = $derived(subject.tracks.filter(track => track.artist.did === account.did));
  let closedInto = $state<string>();
  let reopened = $state(false);
  const shared = $derived.by(() => {
    const spaces = new Set(owned.map(track => trackSpace(track, authConfig.AUDIO_SPACE_TYPE)));
    return spaces.size === 1 ? [...spaces][0] : undefined;
  });
  const space = $derived(reopened ? undefined : closedInto ?? shared);
  const fallback = $derived(space ? implicitRule(space) : undefined);
  const author = $derived(account.did);
  let read = $state.raw<{ space: string; policies?: Policy[]; error?: string }>();
  let attempt = $state(0);
  const policies = $derived(space && read?.space === space ? read.policies : undefined);
  const readError = $derived(space && read?.space === space ? read.error : undefined);
  $effect(() => {
    const current = space;
    const owner = author;
    void attempt;
    if (!current || !owner) return;
    const controller = new AbortController();
    listPolicies(config, owner, current, controller.signal)
      .then(found => { read = { space: current, policies: found }; })
      .catch((failure: unknown) => { if (!controller.signal.aborted) read = { space: current, error: failure instanceof Error ? failure.message : 'could not read who can listen.' }; });
    return () => controller.abort();
  });

  let draft = $state<'members' | 'purchase'>();
  let text = $state('');
  let busy = $state(false);
  let error = $state('');

  let root: HTMLDivElement;
  async function run(work: () => Promise<void>, done: string) {
    busy = true;
    error = '';
    try {
      await work();
      toast.add(done, 'success');
      draft = undefined;
      text = '';
      attempt++;
      onchange?.();
      await tick();
      if (!root.contains(document.activeElement)) root.querySelector<HTMLElement>('button:not(:disabled), a, p')?.focus();
    } catch (failure) { error = failure instanceof Error ? failure.message : 'could not save that. try again.'; }
    finally { busy = false; }
  }
  const add = (rule: Rule) => run(() => addPolicy(auth.getAuth(), space!, rule), `${describeRule(rule)} can now listen`);
  function addDraft() {
    if (draft === 'purchase') {
      const amount = parsePrice(text, CURRENCY);
      if (!amount) { error = 'enter a price, like 5 or 4.99.'; return; }
      void add({ kind: 'purchase', amount, currency: CURRENCY });
    } else if (draft === 'members') {
      const names = text.split(/[\s,]+/).filter(Boolean);
      if (!names.length) { error = 'enter at least one handle.'; return; }
      void run(async () => {
        const members = [...new Set(await Promise.all(names.map(memberDid)))];
        await addPolicy(auth.getAuth(), space!, { kind: 'members', members });
      }, names.length === 1 ? `${names[0]} can now listen` : `${names.length} people can now listen`);
    }
  }
  const closeAll = () => run(async () => {
    closedInto = await trackAccess(auth.getAuth()).close(owned.filter(isOpen).map(track => track.record.uri), subject.skey);
    reopened = false;
  }, `closed this ${subject.noun}. only you can listen until you let people in.`);
  const reopenAll = () => run(async () => {
    await trackAccess(auth.getAuth()).reopen(owned.filter(track => !isOpen(track) || closedInto).map(track => track.record.uri));
    reopened = true;
    closedInto = undefined;
  }, `this ${subject.noun} is open to everyone again.`);

  const openCount = $derived(reopened ? owned.length : closedInto ? 0 : owned.filter(isOpen).length);
  const elsewhere = $derived(closedInto || reopened ? 0 : owned.filter(track => !isOpen(track) && trackSpace(track, authConfig.AUDIO_SPACE_TYPE) !== space).length);
  const errorId = $props.id();
</script>

<div class="access" bind:this={root}>
  {#if !account.policyEditing || !account.closing}
    <p>reconnect to choose who can listen to your tracks.</p>
    <a class="text-button strong" href={`${resolve('/(app)/login')}?${new URLSearchParams({ return_to: returnTo })}`}>reconnect</a>
  {:else if !space}
    <p>{openCount === owned.length ? `this ${subject.noun} is open to everyone.` : `${openCount} of ${owned.length} tracks are open to everyone; ${elsewhere} already have their own access.`}</p>
    {#if openCount > 0}
      <p class="muted">close it to choose who can listen: people you list, supporters, buyers, or anyone signed in.</p>
      <button class="text-button strong" type="button" disabled={busy} onclick={closeAll}>{busy ? 'closing…' : `close this ${subject.noun}`}</button>
    {/if}
  {:else}
    {#if readError}
      <p role="alert">{readError}</p>
      <button class="text-button" type="button" onclick={() => attempt++}>try again</button>
    {:else if !policies}
      <p class="muted" role="status">reading who can listen…</p>
    {:else if policies.length}
      <ul>
        {#each policies as policy (policy.uri)}
          <li>
            <span>{describePolicy(policy)}</span>
            <button class="icon-button" type="button" disabled={busy} aria-label={`remove: ${describePolicy(policy)}`}
              onclick={() => run(() => removePolicy(auth.getAuth(), policy), `removed ${describePolicy(policy)}`)}><Icon name="trash" size={17} /></button>
          </li>
        {/each}
      </ul>
    {:else}
      <p>{fallback ? `${describeRule(fallback)} can listen. adding a way in below replaces that.` : 'only you can listen right now.'}</p>
    {/if}
    {#if draft}
      <form onsubmit={event => { event.preventDefault(); addDraft(); }}>
        <label>{draft === 'purchase' ? `price (${CURRENCY})` : 'handles, separated by commas'}
          <input bind:value={text} autocomplete="off" autocapitalize="none" spellcheck="false" inputmode={draft === 'purchase' ? 'decimal' : 'text'}
            placeholder={draft === 'purchase' ? '5' : 'friend.bsky.social'} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} oninput={() => { error = ''; }} />
        </label>
        <div class="row">
          <button class="text-button strong" type="submit" disabled={busy}>{busy ? 'adding…' : 'add'}</button>
          <button class="text-button" type="button" disabled={busy} onclick={() => { draft = undefined; text = ''; error = ''; }}>cancel</button>
        </div>
      </form>
    {:else if policies}
      <p class="muted">let people in by</p>
      <div class="row">
        <button class="text-button chip" type="button" disabled={busy} onclick={() => { draft = 'members'; error = ''; }}>listing them</button>
        <button class="text-button chip" type="button" disabled={busy || policies.some(policy => policy.rule.kind === 'supporter')} onclick={() => add({ kind: 'supporter' })}>supporting you</button>
        <button class="text-button chip" type="button" disabled={busy} onclick={() => { draft = 'purchase'; error = ''; }}>buying it</button>
        <button class="text-button chip" type="button" disabled={busy || policies.some(policy => policy.rule.kind === 'signedIn')} onclick={() => add({ kind: 'signedIn' })}>signing in</button>
      </div>
      <button class="text-button" type="button" disabled={busy} onclick={reopenAll}>open to everyone</button>
    {/if}
  {/if}
  {#if error}<p id={errorId} class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .access { display: grid; gap: 0.7rem; justify-items: start; }
  p { margin: 0; }
  .muted { color: var(--muted); }
  .error { color: #ef4444; }
  ul { list-style: none; margin: 0; padding: 0; width: 100%; }
  li { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; min-height: 2.75rem; border-bottom: 1px solid var(--line); }
  form { display: grid; gap: 0.5rem; width: 100%; }
  label { display: grid; gap: 0.3rem; color: var(--muted); font-size: 0.9rem; }
  input { min-height: 2.75rem; padding: 0 0.75rem; border: 1px solid var(--line); border-radius: 0.55rem; background: var(--raised); color: var(--text); }
  input[aria-invalid='true'] { border-color: #ef4444; }
  .row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { border: 1px solid var(--line); border-radius: 2rem; }
  .strong { color: var(--accent); font-weight: 620; }
</style>
