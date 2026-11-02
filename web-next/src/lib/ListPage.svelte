<script lang="ts">
	import type { ListDetail, Track } from './api';
	import { player } from './player.svelte';
	import TrackRow from './TrackRow.svelte';

	let { load }: { load: () => Promise<ListDetail> } = $props();
	let list = $state<ListDetail | null>(null);
	let error = $state<string | null>(null);
	const tracks = $derived((list?.members ?? []).map((m) => m.track).filter((t): t is Track => !!t));

	$effect(() => {
		list = null;
		error = null;
		load().then((l) => (list = l)).catch((e) => (error = e.message));
	});
</script>

{#if error}
	<p class="error">{error}</p>
{:else if list}
	<h1>{list.metadata.name ?? 'untitled'}</h1>
	<p class="muted">
		{list.object} by <a href="/u/{list.owner.profile?.handle ?? list.owner.did}">{list.owner.profile?.display_name || list.owner.profile?.handle || list.owner.did}</a>
		· {list.metrics.available_count}/{list.metrics.member_count} available
	</p>
	{#if tracks.length}<button class="btn" onclick={() => player.play(tracks)}>▶ play all</button>{/if}
	<ol class="tracks">
		{#each tracks as track, i (track.id)}
			<TrackRow {tracks} index={i} />
		{/each}
	</ol>
{:else}
	<p class="muted">loading…</p>
{/if}
