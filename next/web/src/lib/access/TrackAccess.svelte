<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { Track } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { accessPlan, accessSummary, draftFrom, draftRules, type AccessDraft } from '@plyr/next-core/access/edit';
	import { describePolicy, implicitRule, isOpen, parsePrice, priceText, spaceParts, trackSpace, type Policy } from '@plyr/next-core/access/policy';
	import { listPolicies } from '@plyr/next-core/access/policy-read';
	import { auth } from '$lib/auth';
	import { authConfig } from '$lib/auth-config';
	import { toast } from '$lib/toast.svelte';
	import { trackHref } from '$lib/tracks';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import PeoplePicker, { type Person } from './PeoplePicker.svelte';
	import { addPolicy, removePolicy, trackAccess } from './pds';

	let { track }: { track: Track } = $props();
	const config = { policyCollection: authConfig.NSID.policy, audioSpaceType: authConfig.AUDIO_SPACE_TYPE };
	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
	const back = $derived(trackHref(track));
	const open = $derived(isOpen(track));
	const space = $derived(trackSpace(track, authConfig.AUDIO_SPACE_TYPE));
	const fallback = $derived(space ? implicitRule(space) : undefined);
	/** the space may hold more tracks than this one, when they were closed together */
	const shared = $derived(!!space && spaceParts(space)?.skey !== track.record.rkey);
	const owner = $derived(account.did === track.artist.did);
	const ready = $derived(owner && !!account.policyEditing && !!account.closing);

	let loaded = $state.raw<{ policies: Policy[] } | { error: string }>();
	let attempt = $state(0);
	$effect(() => {
		void attempt;
		if (!ready) return;
		if (open || !space) { loaded = { policies: [] }; return; }
		const controller = new AbortController();
		listPolicies(config, track.artist.did, space, controller.signal)
			.then(policies => { loaded = { policies }; })
			.catch((failure: unknown) => { if (!controller.signal.aborted) loaded = { error: failure instanceof Error ? failure.message : 'could not read who can listen.' }; });
		return () => controller.abort();
	});

	let everyone = $state(true);
	let people = $state<Person[]>([]);
	let supporter = $state(false);
	let buyers = $state(false);
	let price = $state('');
	let currency = $state('USD');
	let signedIn = $state(false);
	let fixed = $state.raw<Policy[]>([]);
	let initial = $state('');
	let busy = $state(false);
	let error = $state('');
	let priceError = $state('');
	const errorId = $props.id();

	$effect(() => {
		if (!loaded || !('policies' in loaded)) return;
		const { draft, fixed: kept } = draftFrom(open, loaded.policies, fallback);
		everyone = draft.everyone;
		people = draft.members.map(did => ({ did }));
		supporter = draft.supporter;
		buyers = !!draft.purchase;
		currency = draft.purchase?.currency ?? 'USD';
		price = draft.purchase ? priceText(draft.purchase.amount, draft.purchase.currency) : '';
		signedIn = draft.signedIn;
		fixed = kept;
		initial = key(draft);
		void named(draft.members);
	});

	/** names and faces for people picked before this visit */
	async function named(dids: string[]) {
		for (let index = 0; index < dids.length; index += 25) {
			const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles');
			for (const did of dids.slice(index, index + 25)) url.searchParams.append('actors', did);
			const found: { profiles?: { did: string; handle: string; displayName?: string; avatar?: string }[] } = await fetch(url).then(response => response.ok ? response.json() : {}).catch(() => ({}));
			const byDid = new Map((found.profiles ?? []).map(profile => [profile.did, profile]));
			people = people.map(person => {
				const profile = byDid.get(person.did);
				return profile && !person.handle ? { did: person.did, handle: profile.handle, name: profile.displayName?.trim() || undefined, avatar: profile.avatar } : person;
			});
		}
	}

	const amount = $derived(buyers ? parsePrice(price, currency) : undefined);
	const draft = $derived<AccessDraft>({ everyone, members: people.map(person => person.did), supporter, ...(amount ? { purchase: { amount, currency } } : {}), signedIn });
	const key = (value: AccessDraft) => JSON.stringify(value.everyone ? { everyone: true } : { ...value, members: [...value.members].sort() });
	const dirty = $derived(!!initial && (key(draft) !== initial || (buyers && !amount)));
	const label = (did: string) => { const person = people.find(other => other.did === did); return person?.name ?? (person?.handle ? `@${person.handle}` : 'someone'); };
	const summary = $derived(accessSummary(draft, fixed, label));

	const current = () => loaded && 'policies' in loaded ? loaded.policies : [];
	async function save(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		if (buyers && !amount) { priceError = 'enter a price, like 5 or 4.99.'; return; }
		// a space closed the old way lets its fallback in until some policy exists
		if (!everyone && fallback && !current().length && !draftRules(draft).length) {
			error = 'pick at least one way in.';
			return;
		}
		busy = true;
		try {
			const session = auth.getAuth();
			const access = trackAccess(session);
			if (everyone) {
				if (!open) await access.reopen([track.record.uri]);
			} else {
				let target = space;
				let policies = current();
				if (open) {
					target = await access.close([track.record.uri], track.record.rkey);
					policies = await listPolicies(config, track.artist.did, target);
				}
				const plan = accessPlan(policies, draft);
				for (const rule of plan.add) await addPolicy(session, target!, rule);
				for (const policy of plan.remove) await removePolicy(session, policy);
			}
			toast.add(everyone ? 'anyone with the link can listen again.' : 'saved who can listen.', 'success');
			await goto(back, { invalidateAll: true });
		} catch (failure) {
			error = failure instanceof Error ? failure.message : 'could not save that. try again.';
		} finally { busy = false; }
	}
	const login = $derived(`${resolve('/(app)/login')}?${new URLSearchParams({ return_to: `/track/${track.id}/access` })}`);
</script>

<header class="mobile-header">
	<a class="icon-button" href={back} aria-label={`Back to ${track.metadata.title}`}><Icon name="back" /></a>
	<strong>who can listen</strong>
	<span></span>
</header>

<article class="page-content access-page">
	<a class="crumb" href={back}><Icon name="back" size={16} /> <span class="truncate">{track.metadata.title}</span></a>
	<header class="top">
		<div class="thumb"><Artwork src={trackArtwork(track)} size={112} eager /></div>
		<div class="title"><h1>who can listen</h1><p class="truncate">to {track.metadata.title}</p></div>
	</header>

	{#if !account.ready}
		<Loading label="loading account" />
	{:else if !owner}
		<p class="state">only the artist can choose who listens to this track.</p>
		<a class="text-button" href={back}>back to the track</a>
	{:else if !ready}
		<p class="state">reconnect to choose who can listen to your tracks.</p>
		<a class="hero-pill primary start" href={login}>reconnect</a>
	{:else if !open && !space}
		<p class="state">this track is private. only you can listen to it.</p>
	{:else if !loaded}
		<Loading label="reading who can listen" />
	{:else if 'error' in loaded}
		<p class="state" role="alert">{loaded.error} <button class="text-button" type="button" onclick={() => attempt++}>try again</button></p>
	{:else}
		<form onsubmit={save} aria-describedby={error ? errorId : undefined}>
			<fieldset class="mode" disabled={busy}>
				<legend class="hidden-legend">Who can listen</legend>
				<label class:on={everyone}>
					<input type="radio" name="mode" value="everyone" checked={everyone} onchange={() => { everyone = true; }} />
					<Icon name="globe" size={20} />
					<span><b>everyone</b><small>anyone with the link, signed in or not</small></span>
				</label>
				<label class:on={!everyone}>
					<input type="radio" name="mode" value="some" checked={!everyone} onchange={() => { everyone = false; }} />
					<Icon name="lock" size={20} />
					<span><b>only some people</b><small>pick the ways in below</small></span>
				</label>
			</fieldset>

			{#if !everyone}
				<fieldset class="ways" disabled={busy}>
					<legend class="hidden-legend">Ways in</legend>
					<div class="way" class:on={people.length > 0}>
						<div class="way-head"><Icon name="users" size={20} /><span><b>people you pick</b><small>{people.length ? (people.length === 1 ? '1 person' : `${people.length} people`) : 'search by name or handle'}</small></span></div>
						<PeoplePicker bind:people owner={track.artist.did} disabled={busy} />
					</div>
					<label class="way check" class:on={supporter}>
						<input type="checkbox" bind:checked={supporter} />
						<span><b>your supporters</b><small>anyone who supports you through your support link</small></span>
					</label>
					<div class="way" class:on={buyers}>
						<label class="check">
							<input type="checkbox" bind:checked={buyers} onchange={() => { priceError = ''; }} />
							<span><b>people who buy it</b><small>they can listen once they pay</small></span>
						</label>
						{#if buyers}
							<label class="price">
								<span>price ({currency})</span>
								<input bind:value={price} inputmode="decimal" autocomplete="off" placeholder="5" aria-invalid={!!priceError} oninput={() => { priceError = ''; }} />
								{#if priceError}<small class="error" role="alert">{priceError}</small>{/if}
							</label>
						{/if}
					</div>
					<label class="way check" class:on={signedIn}>
						<input type="checkbox" bind:checked={signedIn} />
						<span><b>anyone signed in</b><small>keeps it off the open web</small></span>
					</label>
					{#if fixed.length}
						<div class="also">
							<small>also, set up elsewhere</small>
							<ul>{#each fixed as policy (policy.uri)}<li>{describePolicy(policy)}</li>{/each}</ul>
						</div>
					{/if}
				</fieldset>
			{/if}

			<p class="summary"><Icon name={everyone ? 'globe' : 'lock'} size={16} /> <span>{summary}</span></p>
			{#if shared && !everyone}<p class="note">this track was closed together with others, so their ways in change too.</p>{/if}
			{#if error}<p id={errorId} class="error" role="alert">{error}</p>{/if}
			<div class="save">
				<a class="hero-pill" href={back}>cancel</a>
				<button class="hero-pill primary" type="submit" disabled={busy || !dirty}>{busy ? 'saving…' : 'save'}</button>
			</div>
		</form>
	{/if}
</article>

<style>
	.mobile-header { display: none; }
	.access-page { max-width: 40rem; display: grid; gap: 1.4rem; align-content: start; padding-top: clamp(1rem, 4vw, 2.5rem); padding-bottom: 6rem; }
	.crumb { display: inline-flex; align-items: center; gap: 0.35rem; max-width: 100%; min-height: 2.75rem; justify-self: start; color: var(--muted); font-size: var(--t-14); }
	.top { display: flex; align-items: center; gap: 1rem; min-width: 0; }
	.thumb { flex: none; width: 4.5rem; border-radius: 0.5rem; overflow: hidden; }
	.title { min-width: 0; }
	.top h1 { font-size: clamp(1.6rem, 3vw, 2.2rem); letter-spacing: -0.03em; }
	.top p { margin: 0.15rem 0 0; color: var(--muted); }
	form { display: grid; gap: 1.2rem; }
	fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
	.hidden-legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
	.mode { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
	.mode label, .way { border: 1.5px solid var(--line); border-radius: 0.9rem; background: var(--surface); color: var(--text); }
	.mode label { position: relative; display: flex; align-items: flex-start; gap: 0.7rem; padding: 0.9rem 1rem; cursor: pointer; }
	.mode label:has(:focus-visible), .check:has(:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
	.mode input { position: absolute; opacity: 0; pointer-events: none; }
	.mode label.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
	.mode label.on :global(svg) { color: var(--accent); }
	.mode span, .way span, .way-head span { display: grid; gap: 0.15rem; min-width: 0; }
	small { color: var(--muted); font-size: var(--t-12-8); line-height: 1.35; }
	.ways { display: grid; gap: 0.6rem; }
	.way { display: grid; gap: 0.9rem; padding: 0.9rem 1rem; }
	.way.on { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); }
	.way-head { display: flex; align-items: flex-start; gap: 0.8rem; }
	.way-head :global(svg) { flex: none; color: var(--muted); margin-top: 0.1rem; }
	.check { display: flex; align-items: flex-start; gap: 0.8rem; cursor: pointer; }
	.check input { flex: none; width: 1.3rem; height: 1.3rem; margin: 0.1rem 0 0; accent-color: var(--accent); }
	.price { display: grid; gap: 0.35rem; max-width: 12rem; color: var(--muted); font-size: var(--t-14); }
	.price input { min-height: 2.75rem; padding: 0 0.75rem; border: 1.5px solid var(--line); border-radius: 0.6rem; background: var(--raised); color: var(--text); font-size: max(16px, 1rem); }
	.price input:focus { border-color: var(--accent); outline: 0; }
	.price input[aria-invalid='true'] { border-color: #ef4444; }
	.also { display: grid; gap: 0.3rem; padding: 0 1rem; }
	.also ul { margin: 0; padding-left: 1.1rem; color: var(--muted); font-size: var(--t-14); }
	.summary { display: flex; align-items: flex-start; gap: 0.5rem; margin: 0; color: var(--muted); font-size: var(--t-14); line-height: 1.5; }
	.summary :global(svg) { flex: none; margin-top: 0.2rem; }
	.note { margin: 0; color: var(--muted); font-size: var(--t-13-6); }
	.error { margin: 0; color: #ef4444; }
	.state { margin: 0; color: var(--muted); }
	.start { justify-self: start; }
	.save { display: flex; justify-content: flex-end; gap: 0.5rem; }
	@media (max-width: 720px) {
		.mobile-header { display: grid; grid-template-columns: 2.75rem 1fr 2.75rem; align-items: center; padding: 0.35rem 0.5rem; text-align: center; border-bottom: 1px solid var(--line); background: var(--surface); }
		.crumb, .top { display: none; }
		.mode { grid-template-columns: 1fr; }
		.save > * { flex: 1; }
	}
</style>
