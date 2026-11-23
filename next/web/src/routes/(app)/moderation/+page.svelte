<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { trackIdFromUri } from '@plyr/next-core/api';
	import { shortDate } from '@plyr/next-core/dates';
	import { noteTooLong, REPORT_REASONS, type Decision, type QueueItem, type SubjectEvent } from '@plyr/next-core/moderation';
	import { addGrants, auth, grantFailure } from '$lib/auth';
	import { authConfig } from '$lib/auth-config';
	import { tick } from 'svelte';
	import { isModerator, moderation } from '$lib/moderation/client';
	import { toast } from '$lib/toast.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	let account = $state.raw(auth.getAuth());
	let items = $state<QueueItem[]>([]);
	let cursor = $state<string | undefined>();
	let loading = $state(false);
	let error = $state('');
	let selected = $state<QueueItem | null>(null);
	let history = $state<SubjectEvent[] | null>(null);
	let historyError = $state('');
	let note = $state('');
	let deciding = $state<Decision | null>(null);
	let decideError = $state('');
	let request: AbortController | undefined;
	let historyRequest: AbortController | undefined;

	const allowed = $derived(isModerator(account.did));
	const granted = $derived(account.moderating);
	const noteLong = $derived(noteTooLong(note));
	let granting = $state(false);
	let detailHeading = $state<HTMLHeadingElement>();
	async function allowQueue() {
		granting = true;
		error = '';
		try { await addGrants(authConfig.MODERATOR_SCOPE_PARTS, '/moderation'); }
		catch (failure) { console.warn('moderation grant did not start', failure); error = grantFailure(failure) ?? ''; granting = false; }
	}
	onMount(() => {
		const stop = auth.subscribe(() => { const next = auth.getAuth(); const changed = next.agent !== account.agent; account = next; if (changed) void load(); });
		void load();
		return stop;
	});
	onDestroy(() => { request?.abort(); historyRequest?.abort(); });

	const reasonLabel = (value: string) => REPORT_REASONS.find(option => option.value === value)?.label ?? value;
	function ago(ms: number): string {
		const minutes = Math.max(1, Math.round((Date.now() - ms) / 60_000));
		if (minutes < 60) return `${minutes} min`;
		const hours = Math.round(minutes / 60);
		if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
		return `${Math.round(hours / 24)} days`;
	}
	const day = (ms: number) => shortDate(ms);
	const isTrack = (item: QueueItem) => item.trackTitle !== null;
	function title(item: QueueItem): string {
		if (item.trackTitle) return item.trackTitle;
		if (item.subject.startsWith('did:')) return 'an account';
		if (item.subject.includes('.comment/')) return 'a comment';
		return 'something that was deleted';
	}
	function happened(event: SubjectEvent): string {
		switch (event.action) {
			case 'reported': return `reported: ${reasonLabel(event.reasonType ?? 'other')}`;
			case 'flagged_by_scan': return 'matched a recording';
			case 'flagged_by_rule': return 'flagged automatically';
			case 'acknowledged': return 'looked at: nothing wrong';
			case 'override_allow': return 'allowed';
			case 'override_exclude': return 'kept off feeds';
			case 'override_clear': return 'decision undone';
			case 'label_applied': return `labeled ${event.labelValue}`;
			case 'label_negated': return `label removed: ${event.labelValue}`;
			default: return event.action;
		}
	}

	async function load(more = false) {
		if (!account.agent || !allowed || !account.moderating) return;
		request?.abort();
		const controller = request = new AbortController();
		loading = true;
		error = '';
		try {
			const page = await moderation(account.agent).queue(more ? cursor : undefined, controller.signal);
			items = more ? [...items, ...page.items] : page.items;
			cursor = page.cursor;
			if (!more && selected && !items.some(item => item.subject === selected?.subject)) selected = null;
		} catch (failure) {
			if (!controller.signal.aborted) error = failure instanceof Error ? failure.message : 'could not load the queue.';
		} finally {
			if (request === controller) loading = false;
		}
	}

	async function open(item: QueueItem) {
		if (!account.agent) return;
		selected = item;
		history = null;
		note = '';
		historyError = decideError = '';
		await tick();
		detailHeading?.focus();
		historyRequest?.abort();
		const controller = historyRequest = new AbortController();
		try { history = await moderation(account.agent).subject(item.subject, controller.signal); }
		catch (failure) { if (!controller.signal.aborted) historyError = failure instanceof Error ? failure.message : 'could not load what happened.'; }
	}

	async function decide(action: Decision) {
		const item = selected;
		if (!item || !account.agent || deciding || noteLong) return;
		deciding = action;
		decideError = '';
		try {
			await moderation(account.agent).decide(item.subject, action, { reason: note });
			const at = items.findIndex(entry => entry.subject === item.subject);
			items = items.filter(entry => entry.subject !== item.subject);
			toast.add(`"${title(item)}" decided`, 'success');
			// they may have moved on to another item while this saved
			if (selected?.subject === item.subject) {
				selected = null;
				note = '';
				await focusItem(items[Math.min(at, items.length - 1)]?.subject);
			}
		} catch (failure) {
			// the note stays, so trying again keeps it
			if (selected?.subject === item.subject) decideError = failure instanceof Error ? failure.message : "that didn't go through. try again.";
		} finally {
			deciding = null;
		}
	}

	async function focusItem(subject: string | undefined) {
		await tick();
		const target = subject ? document.querySelector<HTMLButtonElement>(`[data-subject="${CSS.escape(subject)}"]`) : null;
		(target ?? document.querySelector<HTMLElement>('h1'))?.focus();
	}
	async function back() {
		const subject = selected?.subject;
		selected = null;
		await focusItem(subject);
	}

	const choices: { action: Decision; label: string; detail: string; trackOnly: boolean }[] = [
		{ action: 'acknowledged', label: 'nothing wrong', detail: 'closes it; stays where it is', trackOnly: false },
		{ action: 'override_allow', label: 'allow anyway', detail: 'a cover or licensed; keep it in feeds', trackOnly: true },
		{ action: 'override_exclude', label: 'keep it off feeds', detail: 'out of home, search and radio; its page still works', trackOnly: true }
	];
</script>

<svelte:head><title>moderation · plyr.fm</title></svelte:head>

<div class="page-content">
	<header class="top">
		<h1 tabindex="-1">moderation</h1>
		{#if allowed && items.length}<p class="subtle">{items.length}{cursor ? '+' : ''} waiting, oldest first</p>{/if}
	</header>

	{#if !account.ready}
		<Loading label="loading" />
	{:else if !account.did}
		<p class="state">sign in to see this page. <a href={`${resolve('/(app)/login')}?return_to=/moderation`}>sign in</a></p>
	{:else if !allowed}
		<p class="state">only moderators can see this page.</p>
	{:else if !granted}
		<div class="grant">
			<p class="state">to review reports, let plyr.fm open the queue for you. you'll come right back here.</p>
			<button class="hero-pill primary" type="button" disabled={granting} onclick={allowQueue}>{granting ? 'opening…' : 'open the queue'}</button>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</div>
	{:else}
		<div class="layout" class:open={selected}>
			<section class="queue" aria-label="waiting">
				{#if error}<p class="state" role="alert">{error} <button class="text-button" type="button" onclick={() => load()}>try again</button></p>{/if}
				{#if loading && !items.length}<Loading label="loading the queue" inline />{/if}
				{#if !loading && !error && !items.length}<p class="state">nothing waiting. nice.</p>{/if}
				<ul>
					{#each items as item (item.subject)}
						<li>
							<button type="button" class="item" data-subject={item.subject} class:current={selected?.subject === item.subject} onclick={() => open(item)}>
								<span class="what"><strong class="truncate">{title(item)}</strong>
									<small>{item.reasonTypes.length ? item.reasonTypes.map(reasonLabel).join(', ') : 'flagged automatically'}</small></span>
								<span class="meta">{#if item.openCount > 1}<b>{item.openCount} reports</b>{/if}<small>{ago(item.openedAt)}</small></span>
							</button>
						</li>
					{/each}
				</ul>
				{#if cursor}<button class="text-button" type="button" disabled={loading} onclick={() => load(true)}>{loading ? 'loading…' : 'show more'}</button>{/if}
			</section>

			{#if selected}
				<section class="detail" aria-label={`decide on ${title(selected)}`}>
					<header>
						<h2 bind:this={detailHeading} tabindex="-1">{title(selected)}</h2>
						{#if isTrack(selected)}
							<a href={resolve('/(app)/track/[id]', { id: trackIdFromUri(selected.subject) })}>open the track</a>
						{:else if selected.subject.startsWith('did:')}
							<a href={resolve('/(app)/u/[actor]', { actor: selected.subject })}>open the profile</a>
						{/if}
						{#if selected.decision}<p class="subtle">currently {selected.decision === 'allow' ? 'allowed' : 'kept off feeds'}</p>{/if}
					</header>
					<h3>what happened</h3>
					{#if historyError}<p class="state" role="alert">{historyError}</p>
					{:else if !history}<Loading label="loading what happened" inline />
					{:else}
						<ol class="history">
							{#each history as event (event.id)}
								<li><span>{happened(event)}</span><small>{day(event.createdAt)}</small>
									{#if event.reason}<q>{event.reason}</q>{/if}</li>
							{/each}
						</ol>
					{/if}
					<h3>decide</h3>
					<div class="choices">
						{#each choices.filter(choice => !choice.trackOnly || isTrack(selected!)) as choice (choice.action)}
							<button type="button" class="choice" disabled={!!deciding || noteLong} onclick={() => decide(choice.action)}>
								<strong>{deciding === choice.action ? 'saving…' : choice.label}</strong><small>{choice.detail}</small>
							</button>
						{/each}
					</div>
					<label class="note"><span>note for the record (optional)</span>
						<textarea bind:value={note} rows="2" disabled={!!deciding} aria-invalid={noteLong}></textarea></label>
					{#if noteLong}<p class="error" role="alert">that note is too long. shorten it a little.</p>{/if}
					{#if decideError}<p class="error" role="alert">{decideError}</p>{/if}
					<button class="text-button back" type="button" onclick={back}>back to the queue</button>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
	.top { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
	h1 { font-size: 1.6rem; }
	h1:focus, h2:focus { outline: none; }
	.grant { display: flex; flex-direction: column; align-items: start; gap: 0.5rem; }
	.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; }
	@media (min-width: 900px) { .layout.open { grid-template-columns: minmax(0, 22rem) minmax(0, 1fr); } }
	@media (max-width: 899px) { .layout.open .queue { display: none; } }
	ul, ol { list-style: none; margin: 0; padding: 0; }
	.queue ul { display: flex; flex-direction: column; gap: 0.4rem; }
	.item { display: flex; align-items: center; gap: 0.75rem; width: 100%; min-height: 3.5rem; padding: 0.6rem 0.8rem; text-align: start; border: 1px solid var(--line); border-radius: 0.8rem; background: var(--surface); }
	.item:hover { background: var(--hover); }
	.item.current { border-color: var(--accent); }
	.what { display: flex; flex-direction: column; flex: 1; min-width: 0; }
	.meta { display: flex; flex-direction: column; align-items: end; flex: none; font-size: var(--t-12-8); }
	small { color: var(--faint); font-size: var(--t-12-8); }
	.detail { display: flex; flex-direction: column; gap: 0.7rem; padding: 1rem; border: 1px solid var(--line); border-radius: 1rem; background: var(--surface); }
	.detail header { display: flex; flex-direction: column; gap: 0.2rem; }
	.detail header a { color: var(--accent); font-size: var(--t-14-4); }
	h2 { font-size: 1.2rem; }
	h3 { font-size: var(--t-13-6); color: var(--muted); font-weight: 600; margin-top: 0.4rem; }
	.history { display: flex; flex-direction: column; gap: 0.5rem; }
	.history li { display: grid; grid-template-columns: 1fr auto; gap: 0.15rem 0.75rem; }
	.history q { grid-column: 1 / -1; color: var(--muted); font-size: var(--t-14-4); }
	.choices { display: grid; gap: 0.4rem; }
	.choice { display: flex; flex-direction: column; align-items: start; gap: 0.1rem; min-height: 3rem; padding: 0.6rem 0.8rem; border: 1px solid var(--line); border-radius: 0.8rem; background: var(--raised); text-align: start; }
	.choice:hover:not(:disabled) { border-color: var(--accent); }
	.note { display: flex; flex-direction: column; gap: 0.3rem; font-size: var(--t-13-6); color: var(--muted); }
	textarea { width: 100%; font: inherit; font-size: 16px; padding: 0.55rem 0.7rem; border: 1px solid var(--line); border-radius: 0.65rem; background: var(--bg); color: var(--text); resize: vertical; }
	.error { color: light-dark(#b42318, #ff8a80); font-size: var(--t-13-6); }
	.back { align-self: start; }
	@media (min-width: 900px) { .back { display: none; } }
</style>
