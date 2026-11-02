<script lang="ts">
	import { page } from '$app/state';
	import { api, type Artist, type ListSummary, type Track } from '$lib/api';
	import TrackRow from '$lib/TrackRow.svelte';

	let artist = $state<Artist | null>(null);
	let tracks = $state<Track[]>([]);
	let albums = $state<ListSummary[]>([]);
	let playlists = $state<ListSummary[]>([]);
	let error = $state<string | null>(null);

	$effect(() => {
		const handle = page.params.handle!;
		artist = null;
		error = null;
		tracks = albums = playlists = [];
		api
			.artist(handle)
			.then(async (a) => {
				artist = a;
				const [t, al, pl] = await Promise.all([
					api.tracks({ artist_did: a.did, limit: 50 }),
					api.albums(a.did).catch(() => ({ data: [] })),
					api.playlists({ owner_did: a.did }).catch(() => ({ data: [] }))
				]);
				tracks = t.data;
				albums = al.data;
				playlists = pl.data;
			})
			.catch((e) => (error = e.message));
	});
</script>

{#if error}
	<p class="error">{error}</p>
{:else if artist}
	<div class="hero">
		{#if artist.avatar_url}<img src={artist.avatar_url} alt="" />{/if}
		<div>
			<h1>{artist.display_name || artist.handle}</h1>
			<p class="muted">@{artist.handle}</p>
			{#if artist.bio}<p>{artist.bio}</p>{/if}
		</div>
	</div>
	{#if albums.length}
		<h2>albums</h2>
		{#each albums as album (album.id)}
			<a class="card" href="/album/{album.id}">{album.metadata.name ?? 'untitled'} <span class="muted">· {album.metrics.member_count} tracks</span></a>
		{/each}
	{/if}
	<h2>tracks</h2>
	<ol class="tracks">
		{#each tracks as track, i (track.id)}
			<TrackRow {tracks} index={i} />
		{:else}
			<p class="muted">no tracks yet.</p>
		{/each}
	</ol>
	{#if playlists.length}
		<h2>playlists</h2>
		{#each playlists as list (list.id)}
			<a class="card" href="/playlist/{list.id}">{list.metadata.name ?? 'untitled'} <span class="muted">· {list.metrics.member_count} tracks</span></a>
		{/each}
	{/if}
{:else}
	<p class="muted">loading…</p>
{/if}
