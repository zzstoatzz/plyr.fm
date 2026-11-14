<script lang="ts">
	import type { ListDetail } from '$core/api';
	import { collectionArtwork } from '$core/artwork';
	import { player } from './player.svelte';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	import TrackRow from './TrackRow.svelte';

	let { list }: { list: ListDetail } = $props();
	const title = $derived(list.metadata.name || (list.object === 'album' ? 'untitled album' : 'untitled playlist'));
	const tracks = $derived(list.members.flatMap(member => member.track ? [member.track] : []));
	function playAll() {
		if (tracks[0]) player.play(tracks[0], tracks, title);
	}
	function enqueue() {
		for (const track of tracks) player.enqueue(track);
	}
</script>

<svelte:head><title>{title} · plyr.fm</title></svelte:head>

<article class="page-content">
	<header>
		<div class="cover"><Artwork src={collectionArtwork(list)} size={230} eager /></div>
		<div class="copy">
			<h1>{title}</h1>
			{#if list.owner.profile}<a class="subtle" href={`/u/${list.owner.did}`}>{list.owner.profile.display_name}</a>{/if}
			<div class="actions">
				<button type="button" class="primary-button" aria-label={`Play ${title}`} disabled={!tracks.length} onclick={playAll}><Icon name="play" /></button>
				<button type="button" class="text-button" disabled={!tracks.length} onclick={enqueue}><Icon name="queue" /> add to queue</button>
			</div>
		</div>
	</header>
	{#each list.members as member (member.position)}
		{#if member.track}<TrackRow track={member.track} collection={tracks} label={title} />
		{:else}<p class="state">track unavailable</p>{/if}
	{:else}
		<p class="state">no tracks yet.</p>
	{/each}
</article>

<style>
	header { display: flex; align-items: flex-end; gap: 1.5rem; padding-block: 1.25rem 2rem; }
	.cover { width: min(14rem, 38vw); flex: none; border-radius: 0.65rem; }
	.copy { min-width: 0; }
	h1 { overflow-wrap: anywhere; line-height: 1.14; font-size: clamp(1.45rem, 4vw, 3rem); }
	.actions { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.85rem; }
</style>
