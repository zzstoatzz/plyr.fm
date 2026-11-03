<script lang="ts">
	import type { ListDetail, Track } from './api';
	import { auth } from './auth.svelte';
	import { deletePlaylist, removeFromPlaylist, renamePlaylist } from './pds';
	import { player } from './player.svelte';
	import TrackRow from './TrackRow.svelte';

	let { load }: { load: () => Promise<ListDetail> } = $props();
	let list = $state<ListDetail | null>(null);
	let error = $state<string | null>(null);
	const tracks = $derived((list?.members ?? []).map((m) => m.track).filter((t): t is Track => !!t));
	// your own playlist is editable here; the edit goes to your PDS, then we
	// re-read the appview once it has projected the new record.
	const editable = $derived(!!list && list.object === 'playlist' && list.owner.did === auth.did);
	let busy = $state(false);
	let note = $state<string | null>(null);
	let renaming = $state<string | null>(null);

	async function edit(action: () => Promise<string>, after?: () => void) {
		busy = true;
		note = null;
		try {
			const status = await action();
			if (status === 'pending') note = 'saved to your PDS; indexing…';
			if (after) after();
			else list = await load();
		} catch (e) {
			note = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		list = null;
		error = null;
		load().then((l) => (list = l)).catch((e) => (error = e.message));
	});
</script>

{#if error}
	<p class="error">{error}</p>
{:else if list}
	{#if renaming !== null}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				const name = renaming!;
				edit(() => renamePlaylist(list!.record.uri, name));
				renaming = null;
			}}
		>
			<input bind:value={renaming} maxlength="64" aria-label="playlist name" />
			<button class="btn" disabled={busy || !renaming.trim()}>save</button>
			<button class="btn" type="button" onclick={() => (renaming = null)}>cancel</button>
		</form>
	{:else}
		<h1>{list.metadata.name ?? 'untitled'}</h1>
	{/if}
	<p class="muted">
		{list.object} by <a href="/u/{list.owner.profile?.handle ?? list.owner.did}">{list.owner.profile?.display_name || list.owner.profile?.handle || list.owner.did}</a>
		· {list.metrics.available_count}/{list.metrics.member_count} available
	</p>
	{#if tracks.length}<button class="btn" onclick={() => player.play(tracks)}>▶ play all</button>{/if}
	{#if editable}
		<button class="btn" disabled={busy} onclick={() => (renaming = list!.metadata.name ?? '')}>rename</button>
		<button
			class="btn"
			disabled={busy}
			onclick={() => edit(() => deletePlaylist(list!.record.uri), () => (location.href = '/playlists'))}>delete</button
		>
	{/if}
	{#if note}<p class="muted">{note}</p>{/if}
	<ol class="tracks">
		{#each tracks as track, i (track.id)}
			<TrackRow {tracks} index={i}>
				{#snippet actions()}
					{#if editable}
						<button
							class="remove"
							disabled={busy}
							aria-label="remove {track.metadata.title}"
							onclick={() => edit(() => removeFromPlaylist(list!.record.uri, track.record.uri))}>×</button
						>
					{/if}
				{/snippet}
			</TrackRow>
		{/each}
	</ol>
{:else}
	<p class="muted">loading…</p>
{/if}

<style>
	.remove {
		cursor: pointer;
		padding: 0 0.5rem;
	}
	form {
		display: flex;
		gap: 0.5rem;
		margin: 1rem 0;
	}
</style>
