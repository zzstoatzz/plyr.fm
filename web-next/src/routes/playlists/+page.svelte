<script lang="ts">
	import { api, type ListSummary } from '$lib/api';
	import { onMount } from 'svelte';

	let lists = $state<ListSummary[]>([]);
	let cursor = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function more() {
		try {
			const page = await api.playlists({ limit: 30, cursor: cursor ?? undefined });
			lists = [...lists, ...page.data];
			cursor = page.has_more ? (page.next_cursor ?? null) : null;
		} catch (e) {
			error = (e as Error).message;
		}
	}
	onMount(more);
</script>

<h1>playlists</h1>
{#if error}<p class="error">{error}</p>{/if}
{#each lists as list (list.id)}
	<a class="card" href="/playlist/{list.id}">
		{list.metadata.name ?? 'untitled'}
		<span class="muted">· {list.owner.profile?.handle ?? list.owner.did} · {list.metrics.member_count} tracks</span>
	</a>
{:else}
	{#if !error}<p class="muted">no playlists yet.</p>{/if}
{/each}
{#if cursor}<button class="btn more" onclick={more}>more</button>{/if}
