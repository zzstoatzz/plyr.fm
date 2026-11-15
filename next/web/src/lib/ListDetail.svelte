<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import type { AwaitStatus, ListDetail, Track } from '$core/api';
	import type { CollectionRevision } from '$core/collections/collection-order';
	import { applyCollectionRevision } from '$core/collections/projected-collection';
	import { collectionArtwork, trackArtwork } from '$core/artwork';
	import { auth } from './auth';
	import { player } from './player.svelte';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	import Loading from './ui/Loading.svelte';
	import TrackRow from './TrackRow.svelte';

	let { list: indexed }: { list: ListDetail } = $props();
	let account = $state.raw(auth.getAuth());
	let editing = $state(false);
	let copied = $state(false);
	let pending = $state.raw<{ revision: CollectionRevision; baseline: string; tracks: Track[]; status: AwaitStatus; rpc: typeof account.rpc }>();
	const owned = $derived(account.did === indexed.owner.did && !!account.rpc);
	const accepted = $derived(pending?.rpc === account.rpc && pending.revision.uri === indexed.record.uri ? pending : undefined);
	const list = $derived(accepted ? applyCollectionRevision(indexed, accepted.revision, accepted.tracks) : indexed);
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
	const covers = $derived([...new Set(tracks.flatMap(track => {
		const artwork = trackArtwork(track);
		return artwork ? [artwork] : [];
	}))].slice(0, 4));
	async function share() {
		try {
			if (navigator.share) await navigator.share({ title, url: location.href });
			else { await navigator.clipboard.writeText(location.href); copied = true; }
		} catch {}
	}
	function playAll() {
		if (tracks[0]) player.play(tracks[0], tracks, title);
	}
	function enqueue() {
		for (const track of tracks) player.enqueue(track);
	}
</script>

<svelte:head><title>{title} · plyr.fm</title></svelte:head>

<article class="page-content" class:playlist={list.object === 'playlist'} class:album={list.object === 'album'}>
	<header>
		<div class="cover" class:collage={list.object === 'playlist' && covers.length === 4}>
			{#if list.object === 'playlist' && covers.length === 4}
				{#each covers as cover (cover)}<Artwork src={cover} size={112} eager />{/each}
			{:else}
				<Artwork src={collectionArtwork(list)} size={230} eager />
			{/if}
		</div>
		<div class="copy">
			<h1>{title}</h1>
			<div class="subtle meta">
				{#if list.owner.profile}<a href={`/u/${list.owner.did}`}>{list.owner.profile.display_name}</a><span aria-hidden="true">·</span>{/if}
				<span>{list.metrics.member_count} {list.metrics.member_count === 1 ? 'track' : 'tracks'}</span>
				{#if list.metrics.member_count > tracks.length}<span aria-hidden="true">·</span><span>{tracks.length} playable</span>{/if}
			</div>
			<div class="actions">
				<button type="button" class="primary-button play" aria-label={`Play ${title}`} disabled={!tracks.length} onclick={playAll}><Icon name="play" />{#if list.object === 'playlist'}<span>play</span>{/if}</button>
				<button type="button" class="text-button enqueue" disabled={!tracks.length || player.privateMode} title={player.privateMode ? "play a public track to change queues" : undefined} onclick={enqueue}><Icon name="queue" /> add to queue</button>
				<button type="button" class="icon-button share" aria-label={`Share ${list.object}`} onclick={share}><Icon name="share" /></button>
				{#if owned && !editing}<button type="button" class="text-button" onclick={() => { editing = true; }}>edit {list.object}</button>{/if}
			</div>
			{#if copied}<p role="status" class="subtle">link copied</p>{/if}
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
		<section class="members" aria-labelledby="member-title">
			<h2 id="member-title">tracks</h2>
			{#each list.members as member (member.position)}
				{#if member.track}<TrackRow track={member.track} collection={tracks} label={title} />
				{:else}<p class="state unavailable">track unavailable</p>{/if}
			{:else}
				<p class="state">no tracks yet.</p>
			{/each}
		</section>
	{/if}
</article>

<style>
	header { display: flex; align-items: flex-end; gap: 1.5rem; padding-block: 1.25rem 2rem; }
	.cover { width: min(14rem, 38vw); flex: none; border-radius: 0.65rem; overflow: hidden; }
	.collage { display: grid; grid-template-columns: 1fr 1fr; aspect-ratio: 1; }
	.collage :global(.artwork) { border-radius: 0; }
	.meta { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.25rem; }
	.members h2 { font-size: 1.15rem; margin-bottom: 0.6rem; }
	.playlist .members :global(.track), .playlist .unavailable { background: var(--surface); border: 1px solid var(--line); padding: 0.55rem; border-radius: 0.65rem; margin: 0 0 0.5rem; }
	.playlist .play { width: auto; padding: 0 1rem; gap: 0.45rem; }
	.playlist .enqueue { border: 1px solid var(--line); border-radius: 2rem; padding-inline: 0.85rem; }
	.copy { min-width: 0; }
	h1 { overflow-wrap: anywhere; line-height: 1.14; font-size: clamp(1.45rem, 4vw, 3rem); }
	.actions { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.85rem; }
	@media (max-width: 720px) {
		header { align-items: start; flex-direction: column; gap: 1rem; }
		.copy { width: 100%; }
		.playlist .cover { width: min(9rem, 45vw); }
		.playlist .actions { display: grid; grid-template-columns: 1fr; }
		.playlist .share { justify-self: center; }
		.album header { align-items: center; text-align: center; }
		.album .meta, .album .actions { justify-content: center; }
	}
</style>
