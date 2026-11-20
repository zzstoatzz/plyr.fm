<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import type { AwaitStatus, ListDetail, Track } from '@plyr/next-core/api';
	import type { CollectionRevision } from '@plyr/next-core/collections/collection-order';
	import { applyCollectionRevision } from '@plyr/next-core/collections/projected-collection';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { auth } from './auth';
	import { player } from './player.svelte';
	import Artwork from './ui/Artwork.svelte';
	import CollectionArtwork from './collections/CollectionArtwork.svelte';
	import Icon from './ui/Icon.svelte';
	import Loading from './ui/Loading.svelte';
	import TrackRow from './TrackRow.svelte';
	import { catalogRuntime } from '@plyr/next-core/catalog/runtime';
	import { compactCount } from './listening/format';
	import { api } from './api';
	import { offerFor, offerLabel, type Offer } from '@plyr/next-core/selling';

	let { list: indexed }: { list: ListDetail } = $props();
	let account = $state.raw(auth.getAuth());
	let editing = $state(false);
	let copied = $state(false);
	let queueRequest = $state<string>();
	let pending = $state.raw<{ revision: CollectionRevision; baseline: string; tracks: Track[]; status: AwaitStatus; rpc: typeof account.rpc }>();
	const owned = $derived(account.did === indexed.owner.did && !!account.rpc);
	const accepted = $derived(pending?.rpc === account.rpc && pending.revision.uri === indexed.record.uri ? pending : undefined);
	const list = $derived(accepted ? applyCollectionRevision(indexed, accepted.revision, accepted.tracks) : indexed);
	let offer = $state.raw<Offer>();
	onMount(() => {
		const controller = new AbortController();
		api.artist(indexed.owner.did, controller.signal).then(artist => { offer = offerFor(artist, [indexed.record.uri]); }).catch(() => {});
		return () => controller.abort();
	});
	onMount(() => auth.subscribe(() => {
		if (account.rpc !== auth.getAuth().rpc) { editing = false; pending = undefined; }
		account = auth.getAuth();
	}));
	$effect(() => {
		const edit = accepted, latest = indexed.record;
		if (!edit) return;
		if (latest.cid === edit.revision.cid) { pending = undefined; return; }
		if (latest.cid === edit.baseline || !owned) return;
		const session = untrack(() => account);
		let current = true;
		void import('./pds').then(async ({ createPds }) => {
			if (!current) return;
			const revision = await createPds(session).collectionOrder(indexed.object).read(latest.uri);
			if (current && pending === edit && revision.cid === latest.cid) pending = undefined;
		}).catch(() => {});
		return () => { current = false; };
	});
	function saved(revision: CollectionRevision, status: AwaitStatus, tracks: Track[]) {
		pending = { revision, baseline: indexed.record.cid, tracks, rpc: account.rpc, status };
		editing = false;
		if (status === 'indexed') void invalidateAll();
	}
	const title = $derived(list.metadata.name || (list.object === 'album' ? 'untitled album' : 'untitled playlist'));
	const tracks = $derived(list.members.flatMap(member => member.track ? [member.track] : []));
	const active = $derived(player.canEditPublicQueue && tracks.some(track =>
		track.record.uri === player.current?.record.uri && track.record.cid === player.current.record.cid
	));
	const playing = $derived(active && player.playing && !player.outputElsewhere);
	const seconds = $derived(tracks.reduce((total, track) => total + (track.metadata.duration_seconds ?? 0), 0));
	const year = $derived(list.object === 'album' ? new Date(list.metadata.created_at).getFullYear() : NaN);
	const owner = $derived(list.owner.profile);
	const covers = $derived([...new Set(tracks.flatMap(track => {
		const artwork = trackArtwork(track);
		return artwork ? [artwork] : [];
	}))].slice(0, 4));
	const collage = $derived(list.object === 'playlist' && !list.metadata.cover_blob_cid && covers.length === 4);
	async function share() {
		try {
			if (navigator.share) await navigator.share({ title, url: location.href });
			else { await navigator.clipboard.writeText(location.href); copied = true; }
		} catch {}
	}
	function playAll() {
		if (active) player.toggle();
		else if (tracks[0]) player.play(tracks[0], tracks, title);
	}
	function shuffle() {
		const order = [...tracks];
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}
		if (order[0]) player.play(order[0], order, title);
	}
	function addToQueue() {
		queueRequest = list.record.uri;
		player.enqueueCollection(tracks);
	}
</script>

<svelte:head><title>{title} · plyr.fm</title></svelte:head>

<article class="page-content" class:playlist={list.object === 'playlist'} class:album={list.object === 'album'}>
	<header>
		{#if covers[0] || list.media?.artwork}
			<div class="hero-backdrop" aria-hidden="true"><img src={list.media?.artwork?.url ?? covers[0]} alt="" /></div>
		{/if}
		<div class="cover" class:collage>
			{#if collage}
				{#each covers as cover (cover)}<Artwork src={cover} size={112} eager />{/each}
			{:else}
				<CollectionArtwork {list} size={230} eager />
			{/if}
		</div>
		<div class="copy">
			<p class="kind">{list.object}</p>
			<h1>{title}</h1>
			<div class="meta">
				{#if owner}<a class="owner" href={`/u/${list.owner.did}`}><Artwork src={owner.avatar_url ?? undefined} size={22} />{owner.display_name || owner.handle}</a>{/if}
				<span class="hero-chip"><b>{tracks.length.toLocaleString()}</b> {tracks.length === 1 ? 'track' : 'tracks'}</span>
				{#if seconds > 0}<span class="hero-chip"><b>{catalogRuntime(seconds)}</b></span>{/if}
				{#if list.metrics.total_plays > 0}<span class="hero-chip"><b>{compactCount(list.metrics.total_plays)}</b> {list.metrics.total_plays === 1 ? 'play' : 'plays'}</span>{/if}
				{#if Number.isFinite(year)}<span class="hero-chip"><b>{year}</b></span>{/if}
				{#if list.metrics.member_count > tracks.length}<span class="hero-chip">{list.metrics.member_count - tracks.length} unavailable</span>{/if}
			</div>
			<div class="actions">
				<button type="button" class="hero-pill primary" aria-label={`${playing ? 'Pause' : 'Play'} ${title}`} disabled={!tracks.length || active && !playing && player.snapshot.waiting} onclick={playAll}><Icon name={playing ? 'pause' : 'play'} /> {playing ? 'Pause' : 'Play'}</button>
				{#if offer}<a class="hero-pill buy" href={offer.url} target="_blank" rel="noopener noreferrer" aria-label={`Buy ${title}, ${offerLabel(offer)} (opens in a new tab)`}><Icon name="external" /> <span>buy · {offerLabel(offer)}</span></a>{/if}
				<button type="button" class="hero-pill" aria-label={`Add ${title} to queue`} disabled={!tracks.length || !player.canEditPublicQueue} title={!player.canEditPublicQueue ? "play a public track to change queues" : undefined} onclick={addToQueue}><Icon name="queue" /> <span class="long">Add to queue</span><span class="short">Queue</span></button>
				{#if tracks.length > 1}<button type="button" class="hero-round" aria-label={`Shuffle ${title}`} onclick={shuffle}><Icon name="shuffle" /></button>{/if}
				<button type="button" class="hero-round" aria-label={`Share ${title}`} onclick={share}><Icon name="share" /></button>
			</div>
			{#if owned && !editing}<button type="button" class="text-button edit" onclick={() => { editing = true; }}>edit {list.object}</button>{/if}
			{#if copied}<p role="status" class="subtle">link copied</p>{/if}
			{#if queueRequest === list.record.uri && player.snapshot.queueError}<p role="status" class="state">{player.snapshot.queueError}</p>{/if}
		</div>
	</header>
	{#if accepted}
		<p class="state" role="status">{accepted.status === 'rejected' ? 'saved to your account. the catalog could not apply it.' : 'saved to your account. the catalog is catching up.'}</p>
	{/if}
	{#if editing && owned}
		{#key account.rpc}
			{#await import('./collections/CollectionEditor.svelte')}
				<Loading label="loading editor" inline />
			{:then editor}
				<editor.default {account} {list} {saved} close={() => { editing = false; }} />
			{:catch}
				<p role="alert" class="state">could not open the editor.</p>
				<button type="button" class="text-button" onclick={() => { editing = false; }}>close editor</button>
			{/await}
		{/key}
	{:else}
		<section class="members" aria-label={`${title} tracks`}>
			{#each list.members as member, index (member.position)}
				{#if member.track}<TrackRow track={member.track} collection={tracks} label={title} number={list.object === 'album' ? index + 1 : undefined} />
				{:else}<p class="state unavailable">{#if list.object === 'album'}<span class="number">{index + 1}</span>{/if}<span>track unavailable</span></p>{/if}
			{:else}
				<p class="state">no tracks yet.</p>
			{/each}
		</section>
	{/if}
</article>

<style>
	header { position: relative; isolation: isolate; display: flex; align-items: flex-end; gap: 2rem; padding-block: 1.25rem 2rem; }
	.cover { width: min(14.5rem, 38vw); flex: none; border-radius: 0.75rem; overflow: hidden; box-shadow: 0 1.1rem 2.5rem rgb(0 0 0 / 0.3); }
	.collage { display: grid; grid-template-columns: 1fr 1fr; aspect-ratio: 1; }
	.collage :global(.artwork) { border-radius: 0; }
	.copy { min-width: 0; display: grid; justify-items: start; }
	.kind { color: var(--faint); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
	h1 { overflow-wrap: anywhere; line-height: 1.08; font-size: clamp(1.6rem, 4.5vw, 3.25rem); letter-spacing: -0.03em; margin-top: 0.3rem; }
	.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.85rem; color: var(--muted); font-size: 0.875rem; }
	.owner { display: inline-flex; align-items: center; gap: 0.45rem; min-height: 2rem; margin-right: 0.25rem; color: var(--text); font-weight: 600; font-size: 1rem; }
	.owner :global(.artwork) { width: 1.375rem; border-radius: 50%; }
	.actions { display: flex; align-items: center; gap: 0.6rem; margin-top: 1.25rem; }
	.short { display: none; }
	.buy { border: 1.5px solid var(--accent); background: transparent; color: var(--accent); min-width: 0; }
	.buy span { overflow: hidden; text-overflow: ellipsis; }
	.buy:hover { text-decoration: none; }
	.edit { margin-top: 0.5rem; margin-left: -0.5rem; color: var(--accent); }
	.members { display: grid; }
	.playlist .members { gap: 0.5rem; }
	.playlist .members :global(.track), .playlist .unavailable { background: var(--surface); border: 1px solid var(--line); padding: 0.55rem; border-radius: 0.65rem; margin: 0; }
	.album .members :global(.track) { border-bottom: 1px solid var(--line); }
	.album .members :global(.track:last-child) { border-bottom: 0; }
	.album .unavailable { display: flex; align-items: center; gap: 0.75rem; min-height: 3.5rem; margin: 0 -0.5rem; padding-inline: 0.5rem; border-bottom: 1px solid var(--line); }
	.album .number { width: 2.25rem; text-align: center; color: var(--faint); font-variant-numeric: tabular-nums; }
	@media (max-width: 720px) {
		header { flex-direction: column; align-items: center; text-align: center; gap: 1.1rem; padding-top: 0.5rem; }
		.cover { width: min(13rem, 56vw); }
		.copy { width: 100%; justify-items: center; }
		.kind { display: none; }
		h1 { font-size: 1.65rem; margin-top: 0; }
		.meta { justify-content: center; }
		.owner { flex-basis: 100%; justify-content: center; margin: 0 0 0.25rem; }
		.actions { display: grid; grid-template-columns: 1fr 1fr auto auto; width: 100%; }
		.actions .buy { grid-column: 1 / -1; order: 1; justify-content: center; }
		.long { display: none; }
		.short { display: inline; }
		.edit { margin-left: 0; }
	}
</style>
