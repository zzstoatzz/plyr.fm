<script lang="ts">
	import { api, type Track } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { player } from '$lib/player.svelte';
	import TrackRow from '$lib/TrackRow.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ScreenHeader from '$lib/ui/ScreenHeader.svelte';

	let tracks = $state<Track[]>([]);
	let cursor = $state<string | null>(null);
	let loaded = $state(false);
	let error = $state<string | null>(null);

	async function more() {
		if (!auth.did) return;
		try {
			const page = await api.actorLikes(auth.did, { limit: 50, cursor: cursor ?? undefined });
			tracks = [...tracks, ...page.data];
			cursor = page.has_more ? (page.next_cursor ?? null) : null;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loaded = true;
		}
	}
	$effect(() => {
		if (auth.did) more();
	});
</script>

<ScreenHeader title="liked tracks" subtitle={loaded ? `${tracks.length}${cursor ? '+' : ''} tracks` : undefined}>
	{#snippet slot()}
		{#if tracks.length}<button class="btn primary icon" onclick={() => player.play(tracks)} aria-label="play all"><Icon name="play" size={18} /></button>{/if}
	{/snippet}
</ScreenHeader>
{#if auth.ready && !auth.did}
	<p class="empty"><a href="/login">sign in</a> to see your likes.</p>
{:else}
	{#if error}<p class="error pad">{error}</p>{/if}
	<ol class="plain">
		{#each tracks as _, i (tracks[i].id)}<TrackRow {tracks} index={i} />{/each}
	</ol>
	{#if loaded && !tracks.length && !error}<p class="empty">no likes yet.</p>{/if}
	{#if cursor}<div class="pad" style="text-align:center"><button class="btn outline" onclick={more}>more</button></div>{/if}
{/if}
