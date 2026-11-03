<script lang="ts">
	import { page } from '$app/state';
	import { api, type Artist, type ArtistMetrics, type ListSummary, type Track } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { share } from '$lib/menus.svelte';
	import { player, plural } from '$lib/player.svelte';
	import TrackRow from '$lib/TrackRow.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ScreenHeader from '$lib/ui/ScreenHeader.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	type Tab = 'tracks' | 'albums' | 'playlists' | 'likes';
	let artist = $state<Artist | null>(null);
	let metrics = $state<ArtistMetrics | null>(null);
	let tracks = $state<Track[]>([]);
	let albums = $state<ListSummary[]>([]);
	let playlists = $state<ListSummary[]>([]);
	let likes = $state<Track[] | null>(null);
	let error = $state<string | null>(null);
	let tab = $state<Tab>('tracks');

	$effect(() => {
		const handle = page.params.handle!;
		artist = metrics = likes = null;
		error = null;
		tab = 'tracks';
		tracks = albums = playlists = [];
		api
			.artist(handle)
			.then(async (a) => {
				artist = a;
				api.artistMetrics(a.did).then((m) => (metrics = m)).catch(() => {});
				const [t, al, pl] = await Promise.all([
					api.tracks({ artist_did: a.did, limit: 50 }),
					api.albums(a.did).catch(() => ({ data: [] })),
					api.playlists({ owner_did: a.did }).catch(() => ({ data: [] }))
				]);
				tracks = t.data;
				albums = al.data;
				playlists = pl.data;
			})
			.catch((e) => (error = e.message));
	});

	$effect(() => {
		if (tab === 'likes' && artist && likes === null)
			api.actorLikes(artist.did, { limit: 50 }).then((p) => (likes = p.data)).catch(() => (likes = []));
	});

	const tabs = $derived(
		(
			[
				['tracks', tracks.length],
				['albums', albums.length],
				['playlists', playlists.length],
				['likes', null]
			] as [Tab, number | null][]
		).filter(([t, n]) => t === 'tracks' || t === 'likes' || (n ?? 0) > 0)
	);
	const isMe = $derived(!!artist && artist.did === auth.did);
</script>

<ScreenHeader title={artist ? artist.display_name || artist.handle : ''} subtitle={metrics ? plural(metrics.totals.tracks, 'track') : undefined} />

{#if error}
	<p class="error pad">{error}</p>
{:else if artist}
	<section class="head">
		<Artwork src={artist.avatar_url} seed={artist.handle} size={88} round />
		<h1>{artist.display_name || artist.handle}</h1>
		<p class="muted">@{artist.handle}</p>
		{#if metrics}
			<div class="stats small">
				<span><strong>{metrics.totals.tracks}</strong> {metrics.totals.tracks === 1 ? 'track' : 'tracks'}</span>
				<span><strong>{metrics.totals.plays}</strong> plays</span>
			</div>
		{/if}
		{#if artist.bio}<p class="bio">{artist.bio}</p>{/if}
		<div class="actions">
			{#if tracks.length}<button class="btn primary" onclick={() => player.play(tracks)}><Icon name="play" size={16} /> play</button>{/if}
			{#if isMe}<a class="btn outline" href="/portal"><Icon name="edit" size={16} /> portal</a>{/if}
			{#if artist.support_url}<a class="btn outline" href={artist.support_url} target="_blank" rel="noopener">support</a>{/if}
			<button
				class="btn outline icon"
				aria-label="share"
				onclick={async () => (await share(`/u/${artist!.handle}`, artist!.display_name || artist!.handle)) === 'copied' && toast.show('link copied')}
			>
				<Icon name="share" size={18} />
			</button>
		</div>
	</section>

	<div class="tabs" role="tablist">
		{#each tabs as [t] (t)}
			<button role="tab" aria-selected={tab === t} class:active={tab === t} onclick={() => (tab = t)}>{t}</button>
		{/each}
	</div>

	{#if tab === 'tracks'}
		<ol class="plain">
			{#each tracks as _, i (tracks[i].id)}<TrackRow {tracks} index={i} />{:else}<p class="empty">no tracks yet.</p>{/each}
		</ol>
	{:else if tab === 'albums' || tab === 'playlists'}
		<div class="list">
			{#each tab === 'albums' ? albums : playlists as l (l.id)}
				<a class="row-item" href="/{tab === 'albums' ? 'album' : 'playlist'}/{l.id}">
					<Artwork seed={l.metadata.name ?? l.id} size={48} />
					<span class="grow">
						<span class="ellipsis" style="display:block;font-weight:600">{l.metadata.name ?? 'untitled'}</span>
						<span class="muted small">{plural(l.metrics.member_count, 'track')}</span>
					</span>
				</a>
			{/each}
		</div>
	{:else if likes === null}
		<p class="empty">loading…</p>
	{:else}
		<ol class="plain">
			{#each likes as _, i (likes[i].id)}<TrackRow tracks={likes} index={i} />{:else}<p class="empty">no likes yet.</p>{/each}
		</ol>
	{/if}
{:else}
	<p class="empty">loading…</p>
{/if}

<style>
	.head {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--s-2xs);
		padding: var(--s-lg);
	}
	h1 {
		margin-top: var(--s-sm);
		font-size: var(--t-3xl);
		font-weight: 800;
	}
	p {
		margin: 0;
	}
	.stats {
		display: flex;
		gap: var(--s-lg);
		margin-top: var(--s-xs);
		color: var(--c-600);
	}
	.stats strong {
		color: var(--c-1000);
	}
	.bio {
		margin-top: var(--s-sm);
		white-space: pre-wrap;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-sm);
		margin-top: var(--s-md);
	}
	.tabs {
		display: flex;
		border-bottom: 1px solid var(--c-50);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tabs button {
		flex: 1;
		padding: var(--s-md) var(--s-lg);
		border: 0;
		background: none;
		color: var(--c-600);
		font-weight: 600;
		cursor: pointer;
		box-shadow: inset 0 -3px 0 transparent;
	}
	.tabs button.active {
		color: var(--c-1000);
		box-shadow: inset 0 -3px 0 var(--accent);
	}
	.tabs button:hover {
		background: var(--c-25);
	}
</style>
