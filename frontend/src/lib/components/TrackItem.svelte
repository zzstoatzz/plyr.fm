<script lang="ts">
	import ShareButton from './ShareButton.svelte';
	import type { Track } from '$lib/types';

	interface Props {
		track: Track;
		isPlaying?: boolean;
		onPlay: (track: Track) => void;
	}

	let { track, isPlaying = false, onPlay }: Props = $props();

	// construct shareable URL
	const shareUrl = typeof window !== 'undefined'
		? `${window.location.origin}/track/${track.id}`
		: '';
</script>

<div class="track-container" class:playing={isPlaying}>
	<button
		class="track"
		onclick={() => onPlay(track)}
	>
		<div class="track-info">
			<div class="track-title">{track.title}</div>
			<div class="track-artist">
				{track.artist}
				{#if track.album}
					<span class="album">- {track.album}</span>
				{/if}
			</div>
			<div class="track-meta">
				<span>@{track.artist_handle}</span>
				<span class="separator">•</span>
				<span class="plays">{track.play_count} {track.play_count === 1 ? 'play' : 'plays'}</span>
				{#if track.atproto_record_uri}
					{@const parts = track.atproto_record_uri.split('/')}
					{@const did = parts[2]}
					{@const collection = parts[3]}
					{@const rkey = parts[4]}
					<span class="separator">•</span>
					<a
						href={`https://pds.zzstoatzz.io/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=${collection}&rkey=${rkey}`}
						target="_blank"
						rel="noopener"
						class="atproto-link"
						onclick={(e) => e.stopPropagation()}
					>
						view record
					</a>
				{/if}
			</div>
		</div>
	</button>
	<div class="track-actions" role="presentation" onclick={(e) => e.stopPropagation()}>
		<ShareButton url={shareUrl} />
	</div>
</div>

<style>
	.track-container {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: #141414;
		border: 1px solid #282828;
		border-left: 3px solid transparent;
		padding: 1rem;
		transition: all 0.15s ease-in-out;
	}

	.track-container:hover {
		background: #1a1a1a;
		border-left-color: #6a9fff;
		border-color: #333;
		transform: translateX(2px);
	}

	.track-container.playing {
		background: #1a2330;
		border-left-color: #6a9fff;
		border-color: #2a3a4a;
	}

	.track {
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		padding: 0;
		flex: 1;
		min-width: 0;
	}

	.track-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.track-title {
		font-weight: 600;
		font-size: 1.1rem;
		margin-bottom: 0.25rem;
		color: #e8e8e8;
	}

	.track-artist {
		color: #b0b0b0;
		margin-bottom: 0.25rem;
	}

	.album {
		color: #909090;
	}

	.track-meta {
		font-size: 0.85rem;
		color: #808080;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.track-meta .separator {
		color: #555;
	}

	.plays {
		color: #999;
		font-size: 0.8rem;
	}

	.atproto-link {
		color: #6a9fff;
		text-decoration: none;
		font-size: 0.8rem;
		transition: all 0.2s;
		border-bottom: 1px solid transparent;
	}

	.atproto-link:hover {
		color: #8ab3ff;
		border-bottom-color: #8ab3ff;
	}
</style>
