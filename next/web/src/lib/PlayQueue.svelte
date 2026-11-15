<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { auth } from './auth';
	import { jamRoomPath, newJamPath } from './jam-room';
	import { player } from './player.svelte';
	import { artistName, clock, trackHref } from './tracks';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { explicitEnd } from '@plyr/next-core/queue-state';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	let { close }: { close?: () => void } = $props();
	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
	const deviceQueue = $derived(account.did && !account.accountSync && !player.privateMode && !player.jam && !player.liveStation);
	const start = $derived(player.index + 1);
	const queueState = $derived(player.snapshot.state);
	const tail = $derived(player.localMode ? undefined : queueState.tail);
	const end = $derived(tail ? Math.max(start, explicitEnd(queueState)) : player.queue.length);
	const picks = $derived(player.queue.slice(start, end));
	const continuation = $derived(player.queue.slice(end));
	let pickList: HTMLOListElement | undefined = $state();
	let pendingPromotion: { key: string; opener: HTMLButtonElement } | undefined;

	function openJam() {
		const { did } = auth.getAuth();
		const path = player.jam ? jamRoomPath(player.jam.host, player.jam.key)
			: did && player.current ? newJamPath(did, player.current.id) : '/login?return_to=%2Fqueue';
		close?.();
		void goto(path);
	}

	function key(index: number) {
		return player.localMode ? index : queueState.entries[index]?.key ?? index;
	}

	function promotes(index: number) {
		return !!tail && index > start && (index === end || index === end + 1);
	}

	function moveUp(index: number, opener: HTMLButtonElement) {
		const entryKey = key(index);
		if (typeof entryKey === 'string' && promotes(index) && document.activeElement === opener) {
			pendingPromotion = { key: entryKey, opener };
		}
		player.move(index, index - 1);
	}

	$effect(() => {
		const { entries } = queueState;
		const pending = pendingPromotion;
		if (!pending) return;
		const index = entries.findIndex(entry => entry.key === pending.key);
		if (index < start || index >= end) return;
		const target = pickList?.querySelector<HTMLButtonElement>(`[data-queue-key=${CSS.escape(pending.key)}] .cover`);
		if (document.activeElement === document.body || document.activeElement === pending.opener) target?.focus();
		pendingPromotion = undefined;
	});
</script>

<section aria-label="Queue" class="queue" class:rail={!!close}>
	<header>
		<h1>queue</h1>
		<div class="actions">
			{#if player.jam || player.current && player.canEditPublicQueue}
				<button class="icon-button" type="button" aria-label={player.jam ? 'Open Jam' : 'Start a Jam'} title={player.jam ? 'Open Jam' : 'Start a Jam'} onclick={openJam}><Icon name="users" size={18} /></button>
			{/if}
			{#if player.current && !player.liveStation}
				<button class="icon-button" type="button" aria-label="shuffle up next" title="shuffle up next" disabled={picks.length < 2} onclick={() => player.shuffle()}><Icon name="shuffle" size={18} /></button>
				{#if picks.length}
					<button class="icon-button" type="button" aria-label="clear your queued tracks" title="clear your queued tracks" onclick={() => player.clear()}><Icon name="trash" size={18} /></button>
				{/if}
			{/if}
			{#if close}<button class="icon-button" type="button" aria-label="Close queue" onclick={close}><Icon name="x" size={18} /></button>{/if}
		</div>
	</header>
	{#if player.liveStation}
		<p class="state">you’re tuned to {player.liveStation.label} radio.</p>
		<button class="text-button" onclick={() => player.stopRadio()}>leave radio</button>
	{:else if player.current}
		<section aria-labelledby="queue-current">
			<h2 id="queue-current">now playing</h2>
			<div class="row current">{@render row(player.current, player.index, true)}</div>
		</section>
		<section aria-labelledby="queue-picks">
			<div class="queue-head">
				<h2 id="queue-picks">up next</h2>
				<span class="count">{picks.length}</span>
			</div>
			{#if picks.length}
				<ol role="list" bind:this={pickList}>
					{#each picks as track, offset (key(start + offset))}
						<li class="row" data-queue-key={key(start + offset)}>{@render row(track, start + offset, false)}</li>
					{/each}
				</ol>
			{:else}
				<p class="empty">{continuation.length ? 'no tracks queued by you.' : 'add a track to hear it next.'}</p>
			{/if}
		</section>
		{#if tail && continuation.length}
			<section aria-labelledby="queue-continuation">
				<h2 id="queue-continuation">next from {tail.label}</h2>
				<ol role="list">
					{#each continuation as track, offset (key(end + offset))}
						<li class="row">{@render row(track, end + offset, false)}</li>
					{/each}
				</ol>
			</section>
		{/if}
	{:else}
		<p class="state">your queue is empty.</p>
		<a href={resolve('/')}>browse tracks</a>
	{/if}
	{#if deviceQueue}
		<p class="empty">your queue is saved on this device. <a class="queue-signin" href={resolve('/login?return_to=%2Fqueue')} onclick={close}>sign in again</a> to use it on other devices.</p>
	{/if}
	{#if !player.localMode && player.snapshot.queueError}<p class="state" role="status">{player.snapshot.queueError}</p>{/if}
	{#if player.jam?.error}<p class="state" role="status">{player.jam.error}</p>{/if}
</section>

{#snippet row(track: NonNullable<typeof player.current>, index: number, current: boolean)}
		{@const promote = promotes(index)}
		<button class="cover" type="button" aria-label={`${current && player.playing ? 'Pause' : 'Play'} ${track.metadata.title}`} onclick={() => current ? player.toggle() : player.jump(index, true)}>
			<Artwork src={trackArtwork(track)} size={44} eager={index - player.index < 8} />
			<span class="play"><Icon name={current && player.playing ? 'pause' : 'play'} size={18} /></span>
		</button>
		<div class="labels">
			<a class="truncate" href={trackHref(track)}>{track.metadata.title}</a>
			<span class="subtle truncate">{artistName(track)}</span>
		</div>
		<span class="subtle time">{clock(track.metadata.duration_seconds)}</span>
		{#if !current}
			<div class="actions">
				<button class="icon-button move" type="button" aria-label={promote ? `Move ${track.metadata.title} into up next` : `Move ${track.metadata.title} up`} title={promote ? 'move into up next' : 'move up'} disabled={index === start} onclick={event => moveUp(index, event.currentTarget)}><Icon name="down" size={16} /></button>
				<button class="icon-button" type="button" aria-label={`Remove ${track.metadata.title}`} onclick={() => player.remove(index)}><Icon name="x" size={16} /></button>
			</div>
		{/if}
{/snippet}

<style>
	.queue { display: grid; gap: 1.1rem; container-type: inline-size; }
	.rail { padding: 1rem; }
	header, .queue-head { display: flex; justify-content: space-between; align-items: center; }
	.actions { display: flex; align-items: center; }
	h1 { font-size: 1.45rem; letter-spacing: -0.03em; }
	h2, .count { color: var(--muted); font-size: 0.87rem; font-weight: 650; }
	h2 { margin-block-end: 0.55rem; overflow-wrap: anywhere; }
	.count { margin-block-end: 0.55rem; font-variant-numeric: tabular-nums; }
	ol { display: grid; gap: 0.38rem; margin: 0; padding: 0; list-style: none; }
	.row { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem; min-width: 0; border: 1px solid var(--line); border-radius: 0.7rem; background: var(--raised); }
	.current { border-color: color-mix(in srgb, var(--accent), var(--line) 55%); background: color-mix(in srgb, var(--accent) 9%, var(--raised)); }
	.cover { border: 0; padding: 0; width: 2.75rem; flex: none; border-radius: 0.35rem; background: none; position: relative; }
	.play { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.48); color: white; border-radius: inherit; }
	@media (hover: hover) { .cover:not(:hover, :focus-visible) .play { opacity: 0; } }
	.labels { min-width: 0; flex: 1; display: grid; gap: 0.12rem; font-size: 0.9rem; }
	.labels > :first-child { font-weight: 650; }
	.labels span, .time { font-size: 0.75rem; }
	.time { font-variant-numeric: tabular-nums; }
	.move :global(svg) { transform: rotate(180deg); }
	.queue-signin { color: var(--accent); text-decoration: underline; text-underline-offset: 0.2em; }
	.empty { color: var(--muted); margin: 0; font-size: 0.88rem; }
	@container (max-width: 24rem) { .time { display: none; } }
</style>
