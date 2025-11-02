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
		onclick={(e) => {
			// only play if clicking the track itself, not a link inside
			if (e.target instanceof HTMLAnchorElement || (e.target as HTMLElement).closest('a')) {
				return;
			}
			onPlay(track);
		}}
	>
		{#if track.artist_avatar_url}
			<a
				href="/u/{track.artist_handle}"
				class="track-avatar"
			>
				<img src={track.artist_avatar_url} alt={track.artist} />
			</a>
		{/if}
		<div class="track-info">
			<div class="track-title">{track.title}</div>
			<div class="track-artist">
				<a
					href="/u/{track.artist_handle}"
					class="artist-link"
				>
					{track.artist}
				</a>
				{#if track.features && track.features.length > 0}
					<span class="features">
						feat. {track.features.map(f => f.display_name).join(', ')}
					</span>
				{/if}
				{#if track.album}
					<span class="album">- {track.album}</span>
				{/if}
			</div>
			<div class="track-meta">
				<span class="plays">{track.play_count} {track.play_count === 1 ? 'play' : 'plays'}</span>
		{#if track.atproto_record_url}
					<span class="separator">•</span>
					<a
						href={track.atproto_record_url}
						target="_blank"
						rel="noopener"
						class="atproto-link"
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
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.track-avatar {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		display: block;
		text-decoration: none;
		transition: transform 0.2s;
	}

	.track-avatar:hover {
		transform: scale(1.05);
	}

	.track-avatar img {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid #333;
		transition: border-color 0.2s;
	}

	.track-avatar:hover img {
		border-color: #6a9fff;
	}

	.track-info {
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

	.artist-link {
		color: inherit;
		text-decoration: none;
		transition: color 0.2s;
	}

	.artist-link:hover {
		color: #6a9fff;
	}

	.features {
		color: #8ab3ff;
		font-weight: 500;
		margin: 0 0.5rem;
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

	@media (max-width: 768px) {
		.track-container {
			padding: 0.75rem;
			gap: 0.5rem;
		}

		.track {
			gap: 0.5rem;
		}

		.track-avatar {
			width: 48px;
			height: 48px;
		}

		.track-title {
			font-size: 1rem;
			margin-bottom: 0.15rem;
		}

		.track-artist {
			font-size: 0.9rem;
			margin-bottom: 0.15rem;
		}

		.track-meta {
			font-size: 0.75rem;
			flex-wrap: wrap;
		}

		.atproto-link {
			display: none;
		}
	}
</style>
