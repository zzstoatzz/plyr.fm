<script lang="ts">
	import ShareButton from './ShareButton.svelte';
	import LikeButton from './LikeButton.svelte';
	import TrackActionsMenu from './TrackActionsMenu.svelte';
	import type { Track } from '$lib/types';
	import { queue } from '$lib/queue.svelte';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		track: Track;
		isPlaying?: boolean;
		onPlay: (track: Track) => void;
		isAuthenticated?: boolean;
		hideAlbum?: boolean;
	}

	let { track, isPlaying = false, onPlay, isAuthenticated = false, hideAlbum = false }: Props = $props();

	// construct shareable URL - use /track/[id] for link previews
	// the track page will redirect to home with query param for actual playback
	const shareUrl = typeof window !== 'undefined'
		? `${window.location.origin}/track/${track.id}`
		: '';

	function addToQueue(e: Event) {
		e.stopPropagation();
		queue.addTracks([track]);
		toast.success(`queued ${track.title}`, 1800);
	}

	function handleQueue() {
		queue.addTracks([track]);
		toast.success(`queued ${track.title}`, 1800);
	}
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
		{#if track.image_url}
			<div class="track-image">
				<img src={track.image_url} alt="{track.title} artwork" />
			</div>
		{:else if track.artist_avatar_url}
			<a
				href="/u/{track.artist_handle}"
				class="track-avatar"
			>
				<img src={track.artist_avatar_url} alt={track.artist} />
			</a>
		{:else}
			<div class="track-image-placeholder">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M9 18V5l12-2v13"></path>
					<circle cx="6" cy="18" r="3"></circle>
					<circle cx="18" cy="16" r="3"></circle>
				</svg>
			</div>
		{/if}
		<div class="track-info">
			<div class="track-title">{track.title}</div>
			<div class="track-metadata">
				<a
					href="/u/{track.artist_handle}"
					class="artist-link"
				>
					{track.artist}
				</a>
				{#if track.features && track.features.length > 0}
					<span class="metadata-separator">•</span>
					<span class="features-container">
						<span class="features-label">feat.</span>
						{#each track.features as feature, i}
							{#if i > 0}<span class="feature-separator">, </span>{/if}
							<a href="/u/{feature.handle}" class="feature-link">
								{feature.display_name}
							</a>
						{/each}
					</span>
				{/if}
				{#if track.album && !hideAlbum}
					<span class="metadata-separator">•</span>
					<a href="/u/{track.artist_handle}/album/{track.album.slug}" class="album album-link">
						<svg class="album-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<rect x="2" y="2" width="12" height="12" stroke="currentColor" stroke-width="1.5" fill="none"/>
							<circle cx="8" cy="8" r="2.5" fill="currentColor"/>
						</svg>
						{track.album.title}
					</a>
				{/if}
			</div>
			<div class="track-meta">
				<span class="plays">{track.play_count} {track.play_count === 1 ? 'play' : 'plays'}</span>
				{#if track.like_count && track.like_count > 0}
					<span class="meta-separator">•</span>
					<span class="likes">{track.like_count} {track.like_count === 1 ? 'like' : 'likes'}</span>
				{/if}
			</div>
		</div>
	</button>
	<div class="track-actions" role="presentation" onclick={(e) => e.stopPropagation()}>
		<!-- desktop: show individual buttons -->
		<div class="desktop-actions">
			{#if isAuthenticated}
				<LikeButton
					trackId={track.id}
					trackTitle={track.title}
					initialLiked={track.is_liked || false}
					disabled={!track.atproto_record_uri}
					disabledReason={!track.atproto_record_uri ? "track's record is unavailable and cannot be liked" : undefined}
				/>
			{/if}
			<button
				class="action-button"
				onclick={addToQueue}
				title="add to queue"
			>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<!-- plus sign -->
					<line x1="5" y1="15" x2="5" y2="21"></line>
					<line x1="2" y1="18" x2="8" y2="18"></line>
					<!-- list lines -->
					<line x1="9" y1="6" x2="21" y2="6"></line>
					<line x1="9" y1="12" x2="21" y2="12"></line>
					<line x1="9" y1="18" x2="21" y2="18"></line>
				</svg>
			</button>
			<ShareButton url={shareUrl} />
		</div>

		<!-- mobile: show three-dot menu -->
		<div class="mobile-actions">
			<TrackActionsMenu
				trackId={track.id}
				trackTitle={track.title}
				initialLiked={track.is_liked || false}
				shareUrl={shareUrl}
				onQueue={handleQueue}
				isAuthenticated={isAuthenticated}
				likeDisabled={!track.atproto_record_uri}
			/>
		</div>
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
		border-left-color: var(--accent);
		border-color: #333;
		transform: translateX(2px);
	}

	.track-container.playing {
		background: #1a2330;
		border-left-color: var(--accent);
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
		font-family: inherit;
	}

	.track-image,
	.track-image-placeholder {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		overflow: hidden;
		background: #1a1a1a;
		border: 1px solid #282828;
	}

	.track-avatar {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		display: block;
	}

	.track-avatar {
		text-decoration: none;
		transition: transform 0.2s;
	}

	.track-avatar:hover {
		transform: scale(1.05);
	}

	.track-image img,
	.track-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.track-image-placeholder {
		color: #606060;
	}

	.track-avatar img {
		border-radius: 50%;
		border: 2px solid #333;
		transition: border-color 0.2s;
	}

	.track-avatar:hover img {
		border-color: var(--accent);
	}

	.track-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.track-actions {
		display: flex;
		gap: 0.5rem;
		flex-shrink: 0;
		align-items: center;
	}

	.desktop-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.mobile-actions {
		display: none;
	}

	.track-title {
		font-family: inherit;
		font-weight: 600;
		font-size: 1.05rem;
		color: #e8e8e8;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.track-metadata {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		color: #b0b0b0;
		font-size: 0.9rem;
		font-family: inherit;
	}

	.metadata-separator {
		color: #555;
		font-size: 0.7rem;
	}

	.artist-link {
		color: #b0b0b0;
		text-decoration: none;
		transition: color 0.2s;
		font-weight: 500;
		font-family: inherit;
	}

	.artist-link:hover {
		color: var(--accent);
	}

	.features-container {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.features-label {
		color: #8ab3ff;
		font-weight: 500;
	}

	.feature-link {
		color: #8ab3ff;
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s;
	}

	.feature-link:hover {
		color: var(--accent);
		text-decoration: underline;
	}

	.feature-separator {
		color: #8ab3ff;
	}

	.album {
		color: #909090;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		max-width: fit-content;
	}

	.album-link {
		text-decoration: none;
		transition: color 0.2s;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.album-link:hover {
		color: var(--accent);
	}

	.album-icon {
		width: 14px;
		height: 14px;
		opacity: 0.7;
	}

	.track-meta {
		font-size: 0.8rem;
		color: #808080;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.plays {
		color: #999;
		font-family: inherit;
	}

	.meta-separator {
		color: #555;
		font-size: 0.7rem;
	}

	.likes {
		color: #999;
		font-family: inherit;
	}

	.action-button {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid #333;
		border-radius: 4px;
		color: #888;
		cursor: pointer;
		transition: all 0.2s;
		text-decoration: none;
	}

	.action-button:hover {
		background: #1a1a1a;
		border-color: var(--accent);
		color: var(--accent);
	}

	.action-button svg {
		width: 16px;
		height: 16px;
	}

	@media (max-width: 768px) {
		.desktop-actions {
			display: none;
		}

		.mobile-actions {
			display: flex;
		}

		.track-container {
			padding: 0.65rem 0.75rem;
			gap: 0.5rem;
		}

		.track {
			gap: 0.5rem;
		}

		.track-image,
		.track-image-placeholder,
		.track-avatar {
			width: 40px;
			height: 40px;
		}

		.track-title {
			font-size: 0.9rem;
		}

		.track-metadata {
			font-size: 0.8rem;
			gap: 0.35rem;
		}

		.track-meta {
			font-size: 0.7rem;
		}

		.track-actions {
			gap: 0.35rem;
		}

		.action-button {
			width: 32px;
			height: 32px;
		}

		.action-button svg {
			width: 14px;
			height: 14px;
		}
	}

	@media (max-width: 480px) {
		.track-container {
			padding: 0.5rem 0.65rem;
		}

		.track-image,
		.track-image-placeholder,
		.track-avatar {
			width: 36px;
			height: 36px;
		}

		.track-title {
			font-size: 0.85rem;
		}

		.track-metadata {
			font-size: 0.75rem;
		}

		.metadata-separator {
			font-size: 0.6rem;
		}

		.track-meta {
			font-size: 0.65rem;
			gap: 0.35rem;
		}

		.meta-separator {
			font-size: 0.6rem;
		}

		.action-button {
			width: 30px;
			height: 30px;
		}

		.action-button svg {
			width: 13px;
			height: 13px;
		}
	}
</style>
