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
  import WaysInList from './WaysInList.svelte';

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
</script>

{#if space && !result.admitted}
  <WaysInList artist={artistName(track)} ways={result.ways} note={result.note} empty={!!policies} {signIn} />
{/if}
