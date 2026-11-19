<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import type { Track } from '@plyr/next-core/api';
  import { implicitRule, trackSpace, type Policy } from '@plyr/next-core/access/policy';
  import { listPolicies } from '@plyr/next-core/access/policy-read';
  import { waysIn } from '@plyr/next-core/access/ways-in';
  import type { Offer } from '@plyr/next-core/selling';
  import { auth } from '$lib/auth';
  import { authConfig } from '$lib/auth-config';
  import { artistName } from '$lib/tracks';
  import Icon, { type IconName } from '$lib/ui/Icon.svelte';

  // a closed track, seen by someone other than its artist: who can listen and how to get in
  // `admitted`: the rules already let this listener in, so there's nothing to show
  let { track, offer, support, admitted = $bindable(false) }: { track: Track; offer?: Offer; support?: string; admitted?: boolean } = $props();
  const space = $derived(trackSpace(track, authConfig.AUDIO_SPACE_TYPE));
  let policies = $state.raw<Policy[]>();
  const viewer = $derived(auth.getAuth().did ?? undefined);
  $effect(() => {
    const current = space;
    if (!current) return;
    const controller = new AbortController();
    listPolicies({ policyCollection: authConfig.NSID.policy, audioSpaceType: authConfig.AUDIO_SPACE_TYPE }, track.artist.did, current, controller.signal)
      .then(found => { policies = found; }, () => { if (!controller.signal.aborted) policies = []; });
    return () => controller.abort();
  });
  const rules = $derived(policies?.length ? policies : (() => { const rule = space ? implicitRule(space) : undefined; return rule ? [{ rule }] : []; })());
  const result = $derived(waysIn({ artist: artistName(track), rules, offer, support, viewer }));
  $effect(() => { admitted = result.admitted; });
  const signIn = $derived(`${resolve('/(app)/login')}?${new URLSearchParams({ return_to: page.url.pathname + page.url.search })}`);
  const icons: Record<string, IconName> = { buy: 'tag', support: 'heart', 'sign-in': 'user', members: 'users', supporter: 'heart', purchase: 'tag' };
</script>

{#if space && !result.admitted}
  <section class="ways" aria-label="how to listen">
    <p class="lead"><Icon name="lock" size={16} /> {artistName(track)} shares this one with some people</p>
    {#if result.ways.length}
      <ul>
        {#each result.ways as way (way.key)}
          <li>
            <Icon name={icons[way.kind]} size={18} />
            <span class="copy"><span>{way.title}</span><small>{way.detail}</small></span>
            {#if way.url}<a class="go" href={way.url} target="_blank" rel="noopener noreferrer" aria-label={`${way.action} ${way.detail} (opens in a new tab)`}>{way.action} <Icon name="external" size={14} /></a>
            {:else if way.action === 'sign in'}<a class="go" href={signIn}>sign in</a>{/if}
          </li>
        {/each}
      </ul>
    {:else if policies}
      <p class="muted">only {artistName(track)} can listen right now.</p>
    {/if}
    {#if result.note}<p class="note">{result.note}</p>{/if}
  </section>
{/if}

<style>
  .ways { width: min(26rem, 100%); text-align: start; display: grid; gap: 0.6rem; margin-top: 0.5rem; }
  .lead { display: flex; align-items: center; justify-content: center; gap: 0.4rem; color: var(--muted); font-size: 0.9rem; }
  ul { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 0.9rem; background: var(--surface); overflow: hidden; }
  li { display: flex; align-items: center; gap: 0.75rem; padding: 0.8rem 0.9rem; border-bottom: 1px solid var(--line); color: var(--muted); }
  li:last-child { border-bottom: 0; }
  .copy { flex: 1; min-width: 0; display: grid; color: var(--text); }
  small { color: var(--faint); font-size: 0.8rem; }
  .go { display: inline-flex; align-items: center; gap: 0.3rem; min-height: 2.75rem; padding-inline: 0.4rem; color: var(--accent); font-weight: 650; font-size: 0.9rem; white-space: nowrap; }
  .note, .muted { color: var(--faint); font-size: 0.82rem; margin: 0 0.15rem; }
</style>
