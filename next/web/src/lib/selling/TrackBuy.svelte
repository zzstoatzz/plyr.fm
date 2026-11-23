<script lang="ts">
	import { albumUris, sellers } from '$lib/track-extras';
	import Icon from '$lib/ui/Icon.svelte';
	import { offerFor, offerLabel } from '@plyr/next-core/selling';
	import type { Artist, Track } from '@plyr/next-core/api';

	let { track }: { track: Track } = $props();
	// Cached for the session, so reopening now playing shows the link at once instead of popping it in.
	let seller = $state.raw<{ did: string; artist: Artist }>();
	let album = $state.raw<{ trackId: string; uri?: string }>();
	$effect(() => {
		const did = track.artist.did;
		let live = true;
		void sellers.load(did).then(artist => { if (live) seller = { did, artist }; }, () => {});
		return () => { live = false; };
	});
	// A track without its own link falls back to its album's.
	$effect(() => {
		const title = track.metadata.album;
		if (!title) return;
		const { id, artist } = track;
		let live = true;
		void albumUris.load(`${artist.did} ${title}`).then(uri => { if (live) album = { trackId: id, uri }; }, () => {});
		return () => { live = false; };
	});
	const sellerArtist = $derived(seller?.did === track.artist.did ? seller.artist : sellers.peek(track.artist.did));
	const albumUri = $derived(album?.trackId === track.id ? album.uri : track.metadata.album ? albumUris.peek(`${track.artist.did} ${track.metadata.album}`) : undefined);
	const offer = $derived(offerFor(sellerArtist, [track.record.uri, albumUri]));
</script>

{#if offer}<a class="buy" href={offer.url} target="_blank" rel="noopener noreferrer" aria-label={`Buy ${track.metadata.title}, ${offerLabel(offer)} (opens in a new tab)`}><Icon name="external" size={16} /> <span>buy · {offerLabel(offer)}</span></a>{/if}

<style>
	.buy { display: inline-flex; align-items: center; gap: 0.45rem; height: 2.75rem; padding: 0 1.1rem; border: 1.5px solid var(--accent); border-radius: 999px; color: var(--accent); font-weight: 700; max-width: 100%; }
	.buy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.buy:hover { text-decoration: none; background: color-mix(in srgb, var(--accent) 10%, transparent); }
</style>
