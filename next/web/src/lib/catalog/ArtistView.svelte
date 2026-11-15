<script lang="ts">
  import CollectionArtwork from '$lib/collections/CollectionArtwork.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import { subscribeCatalogChanges } from '@plyr/next-core/catalog/changes';
	import { tabForKey } from '@plyr/next-core/catalog/tabs';
	import type { Artist, ArtistMetrics, ListSummary } from '@plyr/next-core/api';
	import { api } from '$lib/api';
	import { auth } from '$lib/auth';
	import { player } from '$lib/player.svelte';
	import TrackRow from '$lib/TrackRow.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import { artistCatalogFor } from './artist-catalog';

	type Totals = ArtistMetrics['totals'] | null;
	let { artist, metrics }: { artist: Artist; metrics: Promise<Totals> } = $props();
	const tabs = ['tracks', 'albums', 'playlists', 'likes'] as const;
	type Tab = typeof tabs[number];
	const catalog = untrack(() => artistCatalogFor(artist.did));
	const readCatalog = () => ({
		tracks: catalog.tracks.snapshot(),
		albums: catalog.albums.snapshot(),
		playlists: catalog.playlists.snapshot(),
		likes: catalog.likes.snapshot()
	});
	const id = $props.id();
	const buttons: Partial<Record<Tab, HTMLButtonElement>> = {};
	let views = $state.raw(readCatalog());
	let account = $state.raw(auth.getAuth());
	let active = $state(false);
	let copied = $state(false);
	let retriedMetrics = $state.raw<Promise<Totals>>();
	const name = $derived(artist.display_name?.trim() || artist.handle || artist.did);
	const owner = $derived(account.did === artist.did);
	const tab = $derived(tabs.find(item => item === page.url.searchParams.get('tab')) ?? 'tracks');
	const visibleMetrics = $derived(retriedMetrics ?? metrics);
	const support = $derived(artist.support_url && /^https?:\/\/[^\s]+$/i.test(artist.support_url) ? artist.support_url : null);
	const profilePath = $derived(resolve('/(app)/u/[actor]', { actor: artist.handle || artist.did }));

	onMount(() => {
		const stopAuth = auth.subscribe(() => { account = auth.getAuth(); });
		const stopCatalog = tabs.map(item => {
			const section = catalog[item];
			section.connect();
			return section.subscribe(() => { views = readCatalog(); });
		});
		const stopChanges = subscribeCatalogChanges(artist.did, () => activateCatalog(tab));
		active = true;
		return () => {
			stopAuth();
			stopChanges();
			for (const stop of stopCatalog) stop();
			for (const item of tabs) catalog[item].disconnect();
		};
	});

	function activateCatalog(selected: Tab) {
		for (const item of tabs) catalog[item].activate(item === 'tracks' || item === selected);
	}

	$effect(() => {
		if (!active) return;
		const selected = tab;
		untrack(() => activateCatalog(selected));
	});

	function select(next: Tab) {
		if (next === tab) return;
		const url = new URL(page.url);
		if (next === 'tracks') url.searchParams.delete('tab');
		else url.searchParams.set('tab', next);
		buttons[next]?.focus({ preventScroll: true });
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function tabKey(event: KeyboardEvent, current: Tab) {
		const next = tabForKey(tabs, current, event.key);
		if (!next) return;
		event.preventDefault();
		select(next);
	}

	function retryMetrics() {
		retriedMetrics = api.artistMetrics(artist.did).then(result => result.totals, () => null);
	}

	async function share() {
		const url = new URL(profilePath, location.origin).href;
		try {
			if (navigator.share) await navigator.share({ title: name, url });
			else {
				await navigator.clipboard.writeText(url);
				copied = true;
			}
		} catch {}
	}
</script>

{#snippet lists(entries: ListSummary[])}
	{#each entries as entry (entry.id)}
		<a class="collection" href={entry.object === 'album' ? resolve('/(app)/album/[id]', { id: entry.id }) : resolve('/(app)/playlist/[id]', { id: entry.id })}>
			<div class="art"><CollectionArtwork list={entry} size={60} /></div>
			<span><strong>{entry.metadata.name || ('untitled ' + entry.object)}</strong><small>{entry.metrics.member_count} {entry.metrics.member_count === 1 ? 'track' : 'tracks'}</small></span>
			<Icon name="chevron" size={18} />
		</a>
	{/each}
{/snippet}

<article class="page-content artist">
	<header>
		<div class="avatar"><Artwork src={artist.avatar_url ?? undefined} size={144} eager /></div>
		<div class="identity">
			<h1>{name}</h1>
			{#if artist.handle}<p>@{artist.handle}</p>{/if}
			{#await visibleMetrics then totals}
				{#if totals}
					<p class="counts">{totals.tracks.toLocaleString()} {totals.tracks === 1 ? 'track' : 'tracks'} · {totals.plays.toLocaleString()} {totals.plays === 1 ? 'play' : 'plays'}</p>
				{:else}
					<p>couldn’t load totals. <button type="button" class="text-button" onclick={retryMetrics}>retry totals</button></p>
				{/if}
			{/await}
		</div>
	</header>
	{#if artist.bio}<p class="bio">{artist.bio}</p>{/if}
	{#if support}<a href={support} target="_blank" rel="noopener noreferrer">support artist</a>{/if}
	<div class="actions">
		{#if views.tracks.data[0]}
			<button class="primary-button" type="button" aria-label={`Play tracks by ${name}`} onclick={() => player.play(views.tracks.data[0], views.tracks.data, name)}><Icon name="play" size={25} /></button>
		{/if}
		<button class="icon-button" type="button" aria-label="Share artist" onclick={share}><Icon name="share" /></button>
		{#if owner}<a class="text-button" href={resolve('/(app)/edit-profile')}>edit profile</a>{/if}
		{#if copied}<span role="status">link copied</span>{/if}
	</div>
	<div class="tabs" role="tablist" aria-label="Artist catalog">
		{#each tabs as item (item)}
			<button type="button" id={`${id}-tab-${item}`} role="tab" bind:this={buttons[item]} aria-controls={`${id}-panel-${item}`}
				aria-selected={tab === item} tabindex={tab === item ? 0 : -1} onclick={() => select(item)} onkeydown={event => tabKey(event, item)}>{item}</button>
		{/each}
	</div>
	{#each tabs as item (item)}
		<div class="panel" id={`${id}-panel-${item}`} role="tabpanel" aria-labelledby={`${id}-tab-${item}`} hidden={item !== tab} tabindex="0">
			{#if item === tab}
				{@const view = views[item]}
				{@const collections = item === 'albums' || item === 'playlists' ? views[item].data.filter(entry => owner || entry.metrics.available_count > 0) : []}
				{@const tracks = item === 'tracks' || item === 'likes' ? views[item].data : []}
				{#if item === 'albums' && owner}<a class="text-button" href={resolve('/(app)/create-album')}>new album</a>{/if}
				{#each tracks as track (track.id)}
					<TrackRow {track} collection={tracks} label={item === 'likes' ? `liked by ${name}` : name} />
				{/each}
				{@render lists(collections)}
				{#if view.error}
					<p class="state" role="alert">{view.error}</p>
					<button type="button" class="text-button" onclick={catalog[item].retry}>retry</button>
				{:else if view.loading}
					<Loading label={`loading ${item}`} inline />
				{:else if !tracks.length && !collections.length}
					<p class="state">no {item} yet.</p>
				{/if}
				{#if view.cursor && !view.error && !view.loading}
					<button type="button" class="text-button" onclick={catalog[item].more}>more {item}</button>
				{/if}
			{/if}
		</div>
	{/each}
</article>

<style>
	.artist { max-width: 69rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.25rem; }
	header { display: grid; grid-template-columns: clamp(5rem, 22vw, 9rem) minmax(0, 1fr); gap: clamp(1rem, 4vw, 2rem); align-items: center; }
	.avatar { border-radius: 50%; overflow: hidden; }
	.identity { display: grid; gap: 0.38rem; overflow-wrap: anywhere; }
	h1 { font-size: clamp(1.58rem, 5vw, 3rem); line-height: 1.13; letter-spacing: -0.035em; }
	.identity p, .bio, small { color: var(--muted); }
	.bio { white-space: pre-wrap; overflow-wrap: anywhere; max-width: 48rem; }
	.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
	.actions .primary-button { width: 4.25rem; height: 4.25rem; box-shadow: 0 0.45rem 1.4rem color-mix(in srgb, var(--accent) 22%, transparent); }
	.tabs { display: flex; flex-wrap: wrap; gap: clamp(0.3rem, 2.5vw, 1.25rem); border-bottom: 1px solid var(--line); }
	.tabs button { min-height: 2.75rem; border: 0; border-bottom: 2px solid transparent; padding-inline: 0.55rem; background: none; color: var(--muted); }
	.tabs [aria-selected="true"] { color: var(--text); font-weight: 700; border-bottom-color: var(--accent); }
	.panel { display: grid; gap: 0.55rem; min-width: 0; }
	.panel :global(.track), .collection { background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; padding: 0.55rem; }
	.panel[hidden] { display: none; }
	.collection { display: grid; grid-template-columns: min(3.25rem, 16vw) minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; overflow-wrap: anywhere; }
	@media (max-width: 520px) {
		.panel :global(.track) { grid-template-columns: min(3.25rem, 16vw) minmax(0, 1fr) auto; }
	}
	.art { border-radius: 0.44rem; }
	small { display: block; }
</style>
