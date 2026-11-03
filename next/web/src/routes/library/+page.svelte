<script lang="ts">
	import { plural } from '$lib/player.svelte';
	import { goto } from '$app/navigation';
	import { api, playlistIdFromUri, type ListSummary, type Track } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { createPlaylist } from '$lib/pds';
	import TrackRow from '$lib/TrackRow.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ScreenHeader from '$lib/ui/ScreenHeader.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	let liked = $state<Track[] | null>(null);
	let lists = $state<ListSummary[] | null>(null);
	let creating = $state(false);
	let name = $state('');
	let busy = $state(false);

	$effect(() => {
		const did = auth.did;
		if (!did) return;
		api.actorLikes(did, { limit: 5 }).then((p) => (liked = p.data)).catch(() => (liked = []));
		api.playlists({ owner_did: did, limit: 100 }).then((p) => (lists = p.data)).catch(() => (lists = []));
	});

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const { uri, status } = await createPlaylist(name);
			creating = false;
			name = '';
			// an empty playlist is a real record, but only shows up once indexed
			if (status === 'indexed') goto(`/playlist/${playlistIdFromUri(uri)}`);
			else toast.show('saved to your PDS · still indexing');
		} catch (err) {
			toast.show((err as Error).message);
		} finally {
			busy = false;
		}
	}
</script>

<ScreenHeader title="library" back={false}>
	{#snippet slot()}
		{#if auth.did}<button class="btn ghost icon" onclick={() => (creating = true)} aria-label="new playlist"><Icon name="plus" /></button>{/if}
	{/snippet}
</ScreenHeader>

{#if !auth.ready}
	<p class="empty">loading…</p>
{:else if !auth.did}
	<div class="empty">
		<p>your liked tracks and playlists live here.</p>
		<a class="btn primary" href="/login">sign in</a>
	</div>
{:else}
	<div class="section"><span>liked tracks</span><a href="/liked">see all</a></div>
	{#if liked === null}
		<p class="muted pad small">loading…</p>
	{:else if liked.length}
		<ol class="plain">
			{#each liked as _, i (liked[i].id)}<TrackRow tracks={liked} index={i} />{/each}
		</ol>
	{:else}
		<p class="muted pad small">tap ♡ on a track to keep it here.</p>
	{/if}

	<div class="section"><span>playlists</span><a href="/playlists">browse all</a></div>
	{#if lists === null}
		<p class="muted pad small">loading…</p>
	{:else}
		<div class="list">
			<button class="row-item" onclick={() => (creating = true)}>
				<span class="new"><Icon name="plus" /></span>
				<span class="grow" style="font-weight:600">new playlist</span>
			</button>
			{#each lists as list (list.id)}
				<a class="row-item" href="/playlist/{list.id}">
					<Artwork src={list.media?.artwork?.url} seed={list.metadata.name ?? list.id} size={48} />
					<span class="grow">
						<span class="ellipsis" style="display:block;font-weight:600">{list.metadata.name ?? 'untitled'}</span>
						<span class="muted small">{plural(list.metrics.member_count, 'track')}</span>
					</span>
					<span class="chev"><Icon name="chevron" size={18} /></span>
				</a>
			{/each}
		</div>
	{/if}
{/if}

<Sheet bind:open={creating} title="new playlist">
	<form onsubmit={create}>
		<label class="field">
			<span>name</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input bind:value={name} maxlength="64" autofocus />
		</label>
		<button class="btn primary block lg" disabled={busy || !name.trim()}>{busy ? 'creating…' : 'create'}</button>
	</form>
</Sheet>

<style>
	.new {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border-radius: var(--r-sm);
		background: var(--c-50);
	}
	.empty .btn {
		margin-top: var(--s-md);
	}
</style>
