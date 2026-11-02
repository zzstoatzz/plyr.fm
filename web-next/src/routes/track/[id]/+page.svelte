<script lang="ts">
	import { page } from '$app/state';
	import { api, type Track } from '$lib/api';
	import LikeButton from '$lib/LikeButton.svelte';
	import { formatDuration, player } from '$lib/player.svelte';

	let track = $state<Track | null>(null);
	let error = $state<string | null>(null);

	$effect(() => {
		const id = page.params.id!;
		track = null;
		error = null;
		api.track(id).then((t) => (track = t)).catch((e) => (error = e.message));
	});
</script>

{#if error}
	<p class="error">{error}</p>
{:else if track}
	<div class="hero">
		{#if track.media.artwork?.url}<img src={track.media.artwork.url} alt="" />{/if}
		<div>
			<h1>{track.metadata.title}</h1>
			<a href="/u/{track.artist.profile.handle}">{track.artist.profile.display_name || track.artist.profile.handle}</a>
			<p class="muted">
				{track.metrics.play_count} plays · {track.metrics.like_count} likes
				{#if track.metadata.duration_seconds}· {formatDuration(track.metadata.duration_seconds)}{/if}
			</p>
			<button class="btn" onclick={() => player.play([track!])}>▶ play</button>
			<LikeButton {track} />
		</div>
	</div>
	{#if track.metadata.description}<p>{track.metadata.description}</p>{/if}
	<p class="muted"><small>{track.record.uri}</small></p>
{:else}
	<p class="muted">loading…</p>
{/if}
