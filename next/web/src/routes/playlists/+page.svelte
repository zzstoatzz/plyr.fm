<script lang="ts">
	import { plural } from '$lib/player.svelte';
	import { api, type ListSummary } from '$lib/api';
	import Artwork from '$lib/ui/Artwork.svelte';
	import ScreenHeader from '$lib/ui/ScreenHeader.svelte';
	import { onMount } from 'svelte';

	let lists = $state<ListSummary[]>([]);
	let cursor = $state<string | null>(null);
	let error = $state<string | null>(null);
	let loaded = $state(false);

	async function more() {
		try {
			const page = await api.playlists({ limit: 30, cursor: cursor ?? undefined });
			lists = [...lists, ...page.data];
			cursor = page.has_more ? (page.next_cursor ?? null) : null;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loaded = true;
		}
	}
	onMount(more);
</script>

<ScreenHeader title="playlists" subtitle="from everyone on plyr" />
{#if error}<p class="error pad">{error}</p>{/if}
<div class="list">
	{#each lists as list (list.id)}
		<a class="row-item" href="/playlist/{list.id}">
			<Artwork src={list.media?.artwork?.url} seed={list.metadata.name ?? list.id} size={48} />
			<span class="grow">
				<span class="ellipsis" style="display:block;font-weight:600">{list.metadata.name ?? 'untitled'}</span>
				<span class="muted small ellipsis" style="display:block">
					{list.owner.profile?.display_name || list.owner.profile?.handle || list.owner.did} · {plural(list.metrics.member_count, 'track')}
				</span>
			</span>
		</a>
	{:else}
		{#if loaded && !error}<p class="empty">no playlists yet.</p>{/if}
	{/each}
</div>
{#if cursor}<div class="pad" style="text-align:center"><button class="btn outline" onclick={more}>more</button></div>{/if}
