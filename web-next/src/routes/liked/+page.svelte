<script lang="ts">
	import { api, type Track } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
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
		// the appview projects the viewer's like records; one paged read, no PDS fan-out
		api
			.actorLikes(auth.did, { limit: 100 })
			.then((page) => (tracks = page.data))
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
