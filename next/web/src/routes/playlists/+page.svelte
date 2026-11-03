<script lang="ts">
	import { api, playlistIdFromUri, type ListSummary } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { createPlaylist } from '$lib/pds';
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

	let name = $state('');
	let busy = $state(false);
	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		try {
			const { uri, status } = await createPlaylist(name);
			// an empty playlist is a real record, but only shows up once indexed
			if (status === 'indexed') location.href = `/playlist/${playlistIdFromUri(uri)}`;
			else error = 'saved to your PDS; still indexing, refresh in a moment';
			name = '';
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<h1>playlists</h1>
{#if auth.did}
	<form class="create" onsubmit={create}>
		<input bind:value={name} placeholder="new playlist" maxlength="64" aria-label="new playlist name" />
		<button class="btn" disabled={busy || !name.trim()}>create</button>
	</form>
{/if}
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

<style>
	.create {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
</style>
