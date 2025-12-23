<script lang="ts">
	import ShareButton from './ShareButton.svelte';
	import AddToMenu from './AddToMenu.svelte';
	import TrackActionsMenu from './TrackActionsMenu.svelte';
	import LikersTooltip from './LikersTooltip.svelte';
	import SensitiveImage from './SensitiveImage.svelte';
	import type { Track } from '$lib/types';
	import { queue } from '$lib/queue.svelte';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		track: Track;
		isPlaying?: boolean;
		onPlay: (_track: Track) => void;
		isAuthenticated?: boolean;
		hideAlbum?: boolean;
		hideArtist?: boolean;
		index?: number;
		showIndex?: boolean;
		excludePlaylistId?: string;
	}

	let {
		track,
		isPlaying = false,
		onPlay,
		isAuthenticated = false,
		hideAlbum = false,
		hideArtist = false,
		index = 0,
		showIndex = false,
		excludePlaylistId
	}: Props = $props();

	// optimize image loading: eager for first 3, lazy for rest
	const imageLoading = index < 3 ? 'eager' : 'lazy';
	const imageFetchPriority = index < 2 ? 'high' : undefined;

	let showLikersTooltip = $state(false);
	// use overridable $derived (Svelte 5.25+) - syncs with prop but can be overridden for optimistic UI
	let likeCount = $derived(track.like_count || 0);
	let commentCount = $derived(track.comment_count || 0);
	// local UI state keyed by track.id - reset when track changes (component recycling)
	let trackImageError = $state(false);
	let avatarError = $state(false);
	let tagsExpanded = $state(false);
	let prevTrackId: number | undefined;

	// reset local UI state when track changes (component may be recycled)
	// using $effect.pre so state is ready before render
	$effect.pre(() => {
		if (prevTrackId !== undefined && track.id !== prevTrackId) {
			trackImageError = false;
			avatarError = false;
			tagsExpanded = false;
		}
		prevTrackId = track.id;
	});

	// limit visible tags to prevent vertical sprawl (max 2 shown)
	const MAX_VISIBLE_TAGS = 2;
	let visibleTags = $derived(
		tagsExpanded ? track.tags : track.tags?.slice(0, MAX_VISIBLE_TAGS)
	);
	let hiddenTagCount = $derived(
		(track.tags?.length || 0) - MAX_VISIBLE_TAGS
	);

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

	let likersTooltipTimeout: ReturnType<typeof setTimeout> | null = null;

	function handleLikesMouseEnter() {
		// cancel any pending close
		if (likersTooltipTimeout) {
			clearTimeout(likersTooltipTimeout);
			likersTooltipTimeout = null;
		}
		showLikersTooltip = true;
	}

	function handleLikesMouseLeave() {
		// delay closing to allow moving into the tooltip
		likersTooltipTimeout = setTimeout(() => {
			showLikersTooltip = false;
			likersTooltipTimeout = null;
		}, 150);
	}

	function handleLikesKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			showLikersTooltip = true;
		}
		if (event.key === 'Escape') {
			showLikersTooltip = false;
		}
	}

	function handleLikeChange(liked: boolean) {
		// update like count immediately
		likeCount = liked ? likeCount + 1 : likeCount - 1;
		// also update the track object itself
		track.like_count = likeCount;
	}
</script>

<div
	class="track-container"
	class:playing={isPlaying}
	class:likers-tooltip-open={showLikersTooltip}
>
	{#if showIndex}
		<span class="track-index">{index + 1}</span>
	{/if}
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
		<div class="track-image-wrapper" class:gated={track.support_gate}>
			{#if track.image_url && !trackImageError}
				<SensitiveImage src={track.image_url}>
					<div class="track-image">
						<img
							src={track.image_url}
							alt="{track.title} artwork"
							width="48"
							height="48"
							loading={imageLoading}
							fetchpriority={imageFetchPriority}
							onerror={() => trackImageError = true}
						/>
					</div>
				</SensitiveImage>
			{:else if track.artist_avatar_url && !avatarError}
				<SensitiveImage src={track.artist_avatar_url}>
					<a
						href="/u/{track.artist_handle}"
						class="track-avatar"
					>
						<img
							src={track.artist_avatar_url}
							alt={track.artist}
							width="48"
							height="48"
							loading={imageLoading}
							fetchpriority={imageFetchPriority}
							onerror={() => avatarError = true}
						/>
					</a>
				</SensitiveImage>
			{:else}
				<div class="track-image-placeholder">
					<svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
						<circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.5" fill="none" />
						<path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
					</svg>
				</div>
			{/if}
			{#if track.support_gate}
				<div class="gated-badge" title="supporters only">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
					</svg>
				</div>
			{/if}
		</div>
		<div class="track-info">
			<div class="track-title">{track.title}</div>
			<div class="track-metadata">
				{#if (!hideArtist) || (track.features && track.features.length > 0)}
					<div class="artist-line"
						class:only-features={hideArtist && track.features && track.features.length > 0}
					>
						{#if !hideArtist}
							<a
								href="/u/{track.artist_handle}"
								class="artist-link"
							>
								{track.artist}
							</a>
						{/if}
						{#if track.features && track.features.length > 0}
							<span class="features-inline">
								<span class="features-label">feat.</span>
								{#each track.features as feature, i}
									{#if i > 0}<span class="feature-separator">, </span>{/if}
									<a href="/u/{feature.handle}" class="feature-link">
										{feature.display_name}
									</a>
								{/each}
							</span>
						{/if}
					</div>
				{/if}
		{#if track.album && !hideAlbum}
			<span class="metadata-separator">•</span>
			<span class="album">
				<svg class="album-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
					<rect x="2" y="2" width="12" height="12" stroke="currentColor" stroke-width="1.5" fill="none"/>
					<circle cx="8" cy="8" r="2.5" fill="currentColor"/>
				</svg>
				<a href="/u/{track.artist_handle}/album/{track.album.slug}" class="album-link">
					{track.album.title}
				</a>
			</span>
		{/if}
		{#if track.tags && track.tags.length > 0}
			<span class="tags-line" class:expanded={tagsExpanded}>
				{#each visibleTags as tag}
					<a href="/tag/{encodeURIComponent(tag)}" class="tag-badge">{tag}</a>
				{/each}
				{#if hiddenTagCount > 0 && !tagsExpanded}
					<span
						class="tags-more"
						role="button"
						tabindex="0"
						onclick={(e) => { e.stopPropagation(); tagsExpanded = true; }}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); tagsExpanded = true; } }}
					>
						+{hiddenTagCount}
					</span>
				{/if}
			</span>
		{/if}
			</div>
			<div class="track-meta">
				<span class="plays">{track.play_count} {track.play_count === 1 ? 'play' : 'plays'}</span>
			{#if likeCount > 0}
				<span class="meta-separator">•</span>
				<span
					class="likes"
					role="button"
					tabindex="0"
					aria-label={`${likeCount} ${likeCount === 1 ? 'like' : 'likes'} (focus to view users)`}
					aria-expanded={showLikersTooltip}
					onmouseenter={handleLikesMouseEnter}
					onmouseleave={handleLikesMouseLeave}
					onfocus={handleLikesMouseEnter}
					onblur={handleLikesMouseLeave}
					onkeydown={handleLikesKeydown}
				>
					{likeCount} {likeCount === 1 ? 'like' : 'likes'}
					{#if showLikersTooltip}
							<LikersTooltip
								trackId={track.id}
								likeCount={likeCount}
								onMouseEnter={handleLikesMouseEnter}
								onMouseLeave={handleLikesMouseLeave}
							/>
						{/if}
					</span>
				{/if}
				{#if commentCount > 0}
					<span class="meta-separator">•</span>
					<a
						href="/track/{track.id}"
						class="comments"
						title="view comments"
					>
						<svg class="comment-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M2 3h12v8H5l-3 3V3z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
						</svg>
						<span class="comment-count">{commentCount}</span>
					</a>
				{/if}
			</div>
		</div>
	</button>
	<div class="track-actions" role="presentation" onclick={(e) => e.stopPropagation()}>
		<!-- desktop: show individual buttons -->
		<div class="desktop-actions">
			{#if isAuthenticated}
				<AddToMenu
					trackId={track.id}
					trackTitle={track.title}
					trackUri={track.atproto_record_uri}
					trackCid={track.atproto_record_cid}
					fileId={track.file_id}
					initialLiked={track.is_liked || false}
					disabled={!track.atproto_record_uri}
					disabledReason={!track.atproto_record_uri ? "track's record is unavailable" : undefined}
					onLikeChange={handleLikeChange}
					{excludePlaylistId}
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
			<ShareButton url={shareUrl} title="share track" />
		</div>

		<!-- mobile: show three-dot menu -->
		<div class="mobile-actions">
			<TrackActionsMenu
				trackId={track.id}
				trackTitle={track.title}
				trackUri={track.atproto_record_uri}
				trackCid={track.atproto_record_cid}
				fileId={track.file_id}
				initialLiked={track.is_liked || false}
				shareUrl={shareUrl}
				onQueue={handleQueue}
				isAuthenticated={isAuthenticated}
				likeDisabled={!track.atproto_record_uri}
				{excludePlaylistId}
			/>
		</div>
	</div>
</div>

<style>
	.track-container {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--track-bg, var(--bg-secondary));
		border: 1px solid var(--track-border, var(--border-subtle));
		border-radius: 8px;
		padding: 1rem;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
		transition:
			box-shadow 0.2s ease-out,
			background 0.15s ease-out,
			border-color 0.15s ease-out;
	}

	.track-index {
		width: 24px;
		font-size: 0.85rem;
		color: var(--text-muted);
		text-align: center;
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	.track-container:hover {
		background: var(--track-bg-hover, var(--bg-tertiary));
		border-color: color-mix(in srgb, var(--accent) 15%, var(--track-border-hover, var(--border-default)));
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.06),
			0 0 8px color-mix(in srgb, var(--accent) 8%, transparent);
	}

	.track-container:active {
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
		transition-duration: 0.08s;
	}

	.track-container.playing {
		background: color-mix(in srgb, var(--accent) 10%, var(--track-bg-playing, var(--bg-tertiary)));
		border-color: color-mix(in srgb, var(--accent) 20%, var(--track-border, var(--border-subtle)));
	}

	/* elevate entire track container when likers tooltip is open
	   z-index: 60 is above header (50) and sibling tracks */
	.track-container.likers-tooltip-open {
		position: relative;
		z-index: 60;
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

	.track-image-wrapper {
		position: relative;
		flex-shrink: 0;
		width: 48px;
		height: 48px;
	}

	.track-image-wrapper.gated::after {
		content: '';
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.3);
		border-radius: 4px;
		pointer-events: none;
	}

	.gated-badge {
		position: absolute;
		bottom: -4px;
		right: -4px;
		width: 18px;
		height: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		border: 2px solid var(--bg-secondary);
		border-radius: 50%;
		color: white;
		z-index: 1;
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
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
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
		color: var(--text-muted);
	}

	.track-avatar img {
		border-radius: 50%;
		border: 2px solid var(--border-default);
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
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.track-metadata {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		color: var(--text-secondary);
		font-size: 0.9rem;
		font-family: inherit;
		min-width: 0;
		width: 100%;
	}

	.artist-line {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		flex-wrap: nowrap;
	}

	.artist-line.only-features {
		gap: 0.25rem;
	}

	.metadata-separator {
		display: none;
		font-size: 0.7rem;
	}

	.artist-link {
		color: var(--text-secondary);
		text-decoration: none;
		transition: color 0.2s;
		font-weight: 500;
		font-family: inherit;
		max-width: 100%;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.artist-link:hover {
		color: var(--accent);
	}

	.features-inline {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.features-label {
		color: var(--accent-hover);
		font-weight: 500;
		text-transform: lowercase;
	}

	.feature-link {
		color: var(--accent-hover);
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s;
	}

	.feature-link:hover {
		color: var(--accent);
		text-decoration: underline;
	}

	.feature-separator {
		color: var(--accent-hover);
	}

	.album {
		color: var(--text-tertiary);
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		width: 100%;
	}

	.album-link {
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 0.2s;
		display: inline-block;
		max-width: 100%;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.album-link:hover {
		color: var(--accent);
	}

	.album-icon {
		width: 14px;
		height: 14px;
		opacity: 0.7;
		flex-shrink: 0;
	}

	.tags-line {
		display: flex;
		flex-wrap: nowrap;
		gap: 0.25rem;
		margin-top: 0.15rem;
		overflow: hidden;
	}

	.tags-line.expanded {
		flex-wrap: wrap;
	}

	.tag-badge {
		display: inline-block;
		padding: 0.1rem 0.4rem;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent-hover);
		border-radius: 3px;
		font-size: 0.75rem;
		font-weight: 500;
		text-decoration: none;
		transition: all 0.15s;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.tag-badge:hover {
		background: color-mix(in srgb, var(--accent) 25%, transparent);
		color: var(--accent);
	}

	.tags-more {
		display: inline-block;
		padding: 0.1rem 0.4rem;
		background: var(--bg-tertiary);
		color: var(--text-muted);
		border: none;
		border-radius: 3px;
		font-size: 0.75rem;
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.tags-more:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.track-meta {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.plays {
		color: var(--text-tertiary);
		font-family: inherit;
	}

	.meta-separator {
		color: var(--text-muted);
		font-size: 0.7rem;
	}

	.likes {
		color: var(--text-tertiary);
		font-family: inherit;
		position: relative;
		cursor: help;
		transition: color 0.2s;
	}

	.likes:hover {
		color: var(--accent);
	}

	.comments {
		color: var(--text-tertiary);
		font-family: inherit;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		text-decoration: none;
		transition: color 0.2s;
	}

	.comments:hover {
		color: var(--accent);
	}

	.comment-icon {
		width: 12px;
		height: 12px;
		flex-shrink: 0;
	}

	.comment-count {
		font-family: inherit;
	}

	.action-button {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.2s;
		text-decoration: none;
	}

	.action-button:hover {
		background: var(--bg-tertiary);
		border-color: var(--accent);
		color: var(--accent);
	}

	.action-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
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

		.track-index {
			display: none;
		}

		.track {
			gap: 0.5rem;
		}

		.track-image-wrapper,
		.track-image,
		.track-image-placeholder,
		.track-avatar {
			width: 40px;
			height: 40px;
		}

		.gated-badge {
			width: 16px;
			height: 16px;
			bottom: -3px;
			right: -3px;
		}

		.gated-badge svg {
			width: 8px;
			height: 8px;
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

		.track-image-wrapper,
		.track-image,
		.track-image-placeholder,
		.track-avatar {
			width: 36px;
			height: 36px;
		}

		.gated-badge {
			width: 14px;
			height: 14px;
			bottom: -2px;
			right: -2px;
		}

		.gated-badge svg {
			width: 7px;
			height: 7px;
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
