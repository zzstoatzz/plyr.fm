<script lang="ts">
	import { api } from '$lib/api';
	import Icon from '$lib/ui/Icon.svelte';
	import { offerFor, offerLabel } from '@plyr/next-core/selling';
	import type { Artist, Track } from '@plyr/next-core/api';

	let { track }: { track: Track } = $props();
	let seller = $state.raw<{ did: string; artist: Artist }>();
	let album = $state.raw<{ trackId: string; uri: string }>();
	$effect(() => {
		const did = track.artist.did;
		const request = new AbortController();
		void api.artist(did, request.signal).then(artist => { seller = { did, artist }; }, () => {});
		return () => request.abort();
	});
	// A track without its own link falls back to its album's.
	$effect(() => {
		const title = track.metadata.album;
		if (!title) return;
		const { id, artist } = track;
		const request = new AbortController();
		void api.search(title, { limit: 20, types: 'album', signal: request.signal }).then(({ data }) => {
			const matches = data.filter(hit => hit.type === 'album' && hit.owner?.did === artist.did && hit.title === title);
			if (!request.signal.aborted) album = matches.length === 1 ? { trackId: id, uri: matches[0].record.uri } : undefined;
		}, () => {});
		return () => request.abort();
	});
	const offer = $derived(offerFor(seller?.did === track.artist.did ? seller.artist : undefined, [track.record.uri, album?.trackId === track.id ? album.uri : undefined]));
</script>

{#if offer}<a class="buy" href={offer.url} target="_blank" rel="noopener noreferrer" aria-label={`Buy ${track.metadata.title}, ${offerLabel(offer)} (opens in a new tab)`}><Icon name="external" size={16} /> <span>buy · {offerLabel(offer)}</span></a>{/if}

<style>
	.buy { display: inline-flex; align-items: center; gap: 0.45rem; height: 2.75rem; padding: 0 1.1rem; border: 1.5px solid var(--accent); border-radius: 999px; color: var(--accent); font-weight: 700; max-width: 100%; }
	.buy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.buy:hover { text-decoration: none; background: color-mix(in srgb, var(--accent) 10%, transparent); }
</style>
