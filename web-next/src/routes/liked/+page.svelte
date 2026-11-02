<script lang="ts">
	import { api, trackIdFromUri, type Track } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { myLikes } from '$lib/pds';
	import TrackRow from '$lib/TrackRow.svelte';

	let tracks = $state<Track[]>([]);
	let error = $state<string | null>(null);
	let loading = $state(true);

	$effect(() => {
		if (!auth.ready) return;
		if (!auth.did) {
			loading = false;
			return;
		}
		// likes come from the viewer's own repo; track details from the appview
		myLikes()
			.then(async (likes) => {
				const ids = [...likes.values()].map((l) => l.subject.uri);
				const resolved = await Promise.all(
					ids.map((uri) => api.track(trackIdFromUri(uri)).catch(() => null))
				);
				tracks = resolved.filter((t): t is Track => !!t);
			})
			.catch((e) => (error = e.message))
			.finally(() => (loading = false));
	});

</script>

<h1>liked</h1>
{#if !auth.did && auth.ready}
	<p class="muted"><a href="/login">sign in</a> to see your likes.</p>
{:else if loading}
	<p class="muted">loading…</p>
{:else}
	{#if error}<p class="error">{error}</p>{/if}
	<ol class="tracks">
		{#each tracks as track, i (track.id)}
			<TrackRow {tracks} index={i} />
		{:else}
			<p class="muted">nothing liked yet.</p>
		{/each}
	</ol>
{/if}
