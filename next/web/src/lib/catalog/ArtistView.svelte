<script lang="ts">
	import { resolve } from '$app/paths';
	import { collectionArtwork } from '@plyr/next-core/artwork';
	import type { Artist, ArtistMetrics, ListSummary, Track } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import { player } from '$lib/player.svelte';
	import TrackRow from '$lib/TrackRow.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	let { artist, tracks, metrics }: { artist: Artist; tracks: Promise<Track[]>; metrics: Promise<ArtistMetrics['totals'] | null> } = $props();
	const tabs = ['tracks', 'albums', 'playlists', 'likes'] as const;
	type Tab = typeof tabs[number];
	type BrowseTab = Exclude<Tab, 'tracks'>;
	let tab = $state<Tab>('tracks');
	let items = $state.raw<Promise<Track[] | ListSummary[]>>();
	let cache: Partial<Record<BrowseTab, Promise<Track[] | ListSummary[]>>> = {};
	let copied = $state(false);
	const name = $derived(artist.display_name || artist.handle);

	function select(next: Tab) {
		tab = next;
		if (next === 'tracks') return;
		const did = artist.did;
		const load = {
			albums: () => api.albums(did),
			playlists: () => api.playlists({ owner_did: did }),
			likes: () => api.actorLikes(did)
		};
		items = cache[next] ??= load[next]().then(result => result.data).catch(error => {
			delete cache[next];
			throw error;
		});
	}

	async function share() {
		try {
			if (navigator.share) await navigator.share({ title: name, url: location.href });
			else {
				await navigator.clipboard.writeText(location.href);
				copied = true;
			}
		} catch {}
	}
</script>

<article class="page-content artist">
	<header>
		<div class="avatar"><Artwork src={artist.avatar_url ?? undefined} size={144} eager /></div>
		<div class="identity">
			<h1>{name}</h1>
			<p>@{artist.handle}</p>
			{#await metrics then totals}
				{#if totals}<p class="counts">{totals.tracks.toLocaleString()} {totals.tracks === 1 ? 'track' : 'tracks'} · {totals.plays.toLocaleString()} {totals.plays === 1 ? 'play' : 'plays'}</p>{/if}
			{/await}
		</div>
	</header>
	{#if artist.bio}<p class="bio">{artist.bio}</p>{/if}
	<div class="actions">
		{#await tracks then songs}
			{#if songs[0]}<button class="primary-button" type="button" aria-label={`Play tracks by ${name}`} onclick={() => player.play(songs[0], songs, name)}><Icon name="play" size={25} /></button>{/if}
		{:catch}{/await}
		<button class="icon-button" type="button" aria-label="Share artist" onclick={share}><Icon name="share" /></button>
		{#if copied}<span role="status">link copied</span>{/if}
	</div>
	<nav aria-label="Artist catalog">
		{#each tabs as item (item)}
			<button type="button" class:active={tab === item} aria-pressed={tab === item} onclick={() => select(item)}>{item}</button>
		{/each}
	</nav>
	<section aria-label={tab}>
		{#if tab === 'tracks'}
			{#await tracks}<Loading label="loading tracks" />
			{:then songs}
				{#each songs as track (track.id)}<TrackRow {track} collection={songs} label={name} />
				{:else}<p class="state">no tracks yet.</p>{/each}
			{:catch}<p class="state">could not load tracks.</p>{/await}
		{:else}
			{#await items}<Loading label={`loading ${tab}`} />
			{:then entries}
				{#each entries ?? [] as entry (entry.id)}
					{#if entry.object === 'track'}<TrackRow track={entry} />
					{:else}
						<a class="collection" href={entry.object === 'album' ? resolve('/(app)/album/[id]', { id: entry.id }) : resolve('/(app)/playlist/[id]', { id: entry.id })}>
							<div class="art"><Artwork src={collectionArtwork(entry)} size={60} /></div>
							<span><strong>{entry.metadata.name || ('untitled ' + entry.object)}</strong><small>{entry.metrics.member_count} {entry.metrics.member_count === 1 ? 'track' : 'tracks'}</small></span>
							<Icon name="chevron" size={18} />
						</a>
					{/if}
				{:else}<p class="state">no {tab} yet.</p>{/each}
			{:catch}
				<p class="state">could not load {tab}.</p>
				<button class="text-button" type="button" onclick={() => select(tab)}>try again</button>
			{/await}
		{/if}
	</section>
</article>

<style>
	.artist { max-width: 69rem; display: grid; gap: 1.25rem; }
	header { display: grid; grid-template-columns: clamp(5rem, 22vw, 9rem) minmax(0, 1fr); gap: clamp(1rem, 4vw, 2rem); align-items: center; }
	.avatar { border-radius: 50%; overflow: hidden; }
	.identity { display: grid; gap: 0.38rem; overflow-wrap: anywhere; }
	h1 { font-size: clamp(1.58rem, 5vw, 3rem); line-height: 1.13; letter-spacing: -0.035em; }
	.identity p, .bio, small { color: var(--muted); }
	.bio { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 48rem; }
	.actions { display: flex; align-items: center; gap: 0.75rem; }
	.actions .primary-button { width: 4.25rem; height: 4.25rem; box-shadow: 0 0.45rem 1.4rem color-mix(in srgb, var(--accent) 22%, transparent); }
	nav { display: flex; gap: clamp(0.3rem, 2.5vw, 1.25rem); border-bottom: 1px solid var(--line); }
	nav button { min-height: 2.75rem; border: 0; border-bottom: 2px solid transparent; padding-inline: 0.55rem; background: none; color: var(--muted); }
	nav .active { color: var(--text); font-weight: 700; border-bottom-color: var(--accent); }
	section { display: grid; gap: 0.55rem; min-width: 0; }
	section :global(.track), .collection { background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; padding: 0.55rem; }
	.collection { display: grid; grid-template-columns: 3.25rem minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; overflow-wrap: anywhere; }
	.art { border-radius: 0.44rem; }
	small { display: block; }
</style>
