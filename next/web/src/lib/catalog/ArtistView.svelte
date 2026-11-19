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
	import { trackArtwork } from '@plyr/next-core/artwork';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';
	import { artistCatalogFor } from './artist-catalog';
	import ListeningNow from './ListeningNow.svelte';
	import { catalogRuntime } from '@plyr/next-core/catalog/runtime';
	import { compactCount } from '$lib/listening/format';
	import { trackHref } from '$lib/tracks';

	type Metrics = ArtistMetrics | null;
	let { artist, metrics }: { artist: Artist; metrics: Promise<Metrics> } = $props();
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
	let retriedMetrics = $state.raw<Promise<Metrics>>();
	const name = $derived(artist.display_name?.trim() || artist.handle || artist.did);
	const owner = $derived(account.did === artist.did);
	const tab = $derived(tabs.find(item => item === page.url.searchParams.get('tab')) ?? 'tracks');
	const visibleMetrics = $derived(retriedMetrics ?? metrics);
	const supportLabel = (url: string) => url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
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
		retriedMetrics = api.artistMetrics(artist.did).catch(() => null);
	}

	function shuffle() {
		const order = [...views.tracks.data];
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}
		if (order[0]) player.play(order[0], order, name);
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
		{#if artist.avatar_url}<div class="hero-backdrop" aria-hidden="true"><img src={artist.avatar_url} alt="" /></div>{/if}
		<div class="avatar"><Artwork src={artist.avatar_url ?? undefined} size={176} eager /></div>
		<div class="identity">
			<h1>{name}</h1>
			{#if artist.handle && artist.display_name?.trim() && artist.display_name.trim() !== artist.handle}<p class="handle">@{artist.handle}</p>{/if}
			{#if artist.bio}<p class="bio">{artist.bio}</p>{/if}
			{#await visibleMetrics then result}
				{#if result}
					<div class="chips">
						<span class="hero-chip"><b>{result.totals.plays.toLocaleString()}</b> {result.totals.plays === 1 ? 'play' : 'plays'}</span>
						<span class="hero-chip"><b>{result.totals.tracks.toLocaleString()}</b> {result.totals.tracks === 1 ? 'track' : 'tracks'}</span>
						{#if result.totals.duration_seconds > 0}<span class="hero-chip"><b>{catalogRuntime(result.totals.duration_seconds)}</b> of music</span>{/if}
					</div>
				{:else}
					<p class="subtle">couldn’t load totals. <button type="button" class="text-button" onclick={retryMetrics}>retry totals</button></p>
				{/if}
			{/await}
			<div class="actions">
				{#if views.tracks.data[0]}
					<button class="hero-pill primary" type="button" aria-label={`Play ${name}`} onclick={() => player.play(views.tracks.data[0], views.tracks.data, name)}><Icon name="play" /> Play</button>
					{#if views.tracks.data.length > 1}<button class="hero-pill" type="button" aria-label={`Shuffle ${name}`} onclick={shuffle}><Icon name="shuffle" /> Shuffle</button>{/if}
				{/if}
				{#if owner}<a class="hero-round" href={resolve('/(app)/edit-profile')} aria-label="edit profile"><Icon name="edit" /></a>{/if}
				<button class="hero-round" type="button" aria-label="Share artist" onclick={share}><Icon name="share" /></button>
			</div>
			{#if copied}<p role="status" class="subtle">link copied</p>{/if}
		</div>
	</header>
	<div class="cards">
		<ListeningNow did={artist.did} {name} />
		{#await visibleMetrics then result}
			{#if support}
				<a class="card" href={support} target="_blank" rel="noopener noreferrer" aria-label={`Support ${name} at ${supportLabel(support)}`}>
					<span class="lead heart"><Icon name="heart" size={20} /></span>
					<span class="card-copy"><small>support {name}</small><strong class="truncate">{supportLabel(support)}</strong></span>
					<Icon name="chevron" size={16} />
				</a>
			{/if}
			{#if result?.top_track}
				{@const top = result.top_track}
				{@const art = views.tracks.data.find(track => track.id === top.id)}
				<a class="card" href={trackHref({ id: top.id })} aria-label={`Most played: ${top.title}`}>
					<span class="lead"><Artwork src={art ? trackArtwork(art) : undefined} size={40} /></span>
					<span class="card-copy"><small>most played</small><strong class="truncate">{top.title}</strong></span>
					<span class="meta">{compactCount(top.play_count)} {top.play_count === 1 ? 'play' : 'plays'}</span>
					<Icon name="chevron" size={16} />
				</a>
				{/if}
		{/await}
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
	header { position: relative; isolation: isolate; display: flex; align-items: center; gap: 2.25rem; padding-block: 1.25rem 0.75rem; }
	.avatar { width: 11rem; flex: none; border-radius: 50%; overflow: hidden; box-shadow: 0 0.7rem 2rem rgb(0 0 0 / 0.3); }
	.identity { min-width: 0; display: grid; justify-items: start; gap: 0.35rem; overflow-wrap: anywhere; }
	h1 { font-size: clamp(1.75rem, 5vw, 3.25rem); line-height: 1.08; letter-spacing: -0.035em; }
	.handle { color: var(--muted); }
	.bio { color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; max-width: 44rem; margin-top: 0.35rem; }
	.chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; }
	.actions { display: flex; align-items: center; gap: 0.6rem; margin-top: 1rem; }
	.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr)); align-items: start; gap: 0.6rem; }
	.cards:not(:has(*)) { display: none; }
	.card { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; min-height: 3.75rem; padding: 0.6rem 0.75rem; border-radius: 0.75rem; background: var(--raised); color: var(--text); text-decoration: none; }
	.card:hover { background: var(--hover); }
	.card > :global(svg) { color: var(--faint); flex: none; }
	.lead { width: 2.5rem; height: 2.5rem; flex: none; border-radius: 0.4rem; overflow: hidden; display: grid; place-items: center; }
	.lead.heart { border-radius: 50%; background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
	.card-copy { flex: 1 1 8rem; min-width: 0; display: grid; overflow-wrap: anywhere; }
	.card-copy small { color: var(--faint); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
	.card-copy strong { font-weight: 600; }
	.card .meta { color: var(--muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.tabs { display: flex; flex-wrap: wrap; gap: clamp(0.3rem, 2.5vw, 1.25rem); border-bottom: 1px solid var(--line); }
	.tabs button { min-height: 2.75rem; border: 0; border-bottom: 2px solid transparent; padding-inline: 0.55rem; background: none; color: var(--muted); }
	.tabs [aria-selected="true"] { color: var(--text); font-weight: 700; border-bottom-color: var(--accent); }
	.panel { display: grid; gap: 0.55rem; min-width: 0; }
	.panel :global(.track), .collection { background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; padding: 0.55rem; }
	.panel[hidden] { display: none; }
	.collection { display: grid; grid-template-columns: min(3.25rem, 16vw) minmax(0, 1fr) auto; align-items: center; gap: 0.75rem; overflow-wrap: anywhere; }
	@media (max-width: 720px) {
		header { flex-direction: column; text-align: center; gap: 1rem; padding-top: 0.5rem; }
		.avatar { width: min(7.25rem, 36vw); }
		.identity { width: 100%; justify-items: center; }
		h1 { font-size: 1.85rem; }
		.chips { justify-content: center; }
		.actions { display: flex; flex-wrap: wrap; width: 100%; }
		.actions .hero-pill { flex: 1 1 auto; }
		.cards { grid-template-columns: minmax(0, 1fr); }
	}
	@media (max-width: 520px) {
		.panel :global(.track) { grid-template-columns: min(3.25rem, 16vw) minmax(0, 1fr) auto; }
	}
	.art { border-radius: 0.44rem; }
	small { display: block; }
</style>
