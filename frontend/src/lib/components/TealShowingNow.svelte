<script lang="ts">
	import { player } from '$lib/player.svelte';

	// mirrors the backend's teal status rule: public tracks only, while playing
	let track = $derived.by(() => {
		if (player.paused || player.radio?.live) return null;
		const current = player.radio?.track ?? player.currentTrack;
		if (!current || current.unlisted || current.support_gate || current.audio_space) return null;
		return current.audio_storage === 'r2_private' ? null : current;
	});
</script>

{#if track}
	<p class="showing-now">
		<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
		showing now: {track.title} · {track.artist}
	</p>
{/if}

<style>
	.showing-now {
		margin: 0.5rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.eq {
		display: inline-flex;
		gap: 2px;
		align-items: flex-end;
		height: 10px;
		margin-right: 0.4rem;
	}

	.eq i {
		display: block;
		width: 2px;
		background: var(--accent);
	}

	.eq i:nth-child(1) {
		height: 6px;
	}

	.eq i:nth-child(2) {
		height: 10px;
	}

	.eq i:nth-child(3) {
		height: 4px;
	}
</style>
