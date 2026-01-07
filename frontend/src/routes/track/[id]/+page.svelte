<script lang="ts">
	import { fade } from 'svelte/transition';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import type { PageData } from './$types';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import { API_URL } from '$lib/config';
	import Header from '$lib/components/Header.svelte';
	import AddToMenu from '$lib/components/AddToMenu.svelte';
	import ShareButton from '$lib/components/ShareButton.svelte';
	import TagEffects from '$lib/components/TagEffects.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import { checkImageSensitive } from '$lib/moderation.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { playTrack, guardGatedTrack } from '$lib/playback.svelte';
	import { auth } from '$lib/auth.svelte';
	import { toast } from '$lib/toast.svelte';
	import type { Track } from '$lib/types';

	interface Comment {
		id: number;
		user_did: string;
		user_handle: string;
		user_display_name: string | null;
		user_avatar_url: string | null;
		text: string;
		timestamp_ms: number;
		created_at: string;
		updated_at: string | null;
	}

	// receive server-loaded data
	let { data }: { data: PageData } = $props();

	let track = $state<Track>(data.track);

	// SSR-safe sensitive image check using server-loaded data
	function isImageSensitiveSSR(url: string | null | undefined): boolean {
		if (!data.sensitiveImages) return false;
		return checkImageSensitive(url, data.sensitiveImages);
	}

	// comments state - assume enabled until we know otherwise
	let comments = $state<Comment[]>([]);
	let commentsEnabled = $state<boolean | null>(null); // null = unknown, true/false = known
	let loadingComments = $state(true);
	let newCommentText = $state('');
	let submittingComment = $state(false);
	let editingCommentId = $state<number | null>(null);
	let editingCommentText = $state('');

	// reactive check if this track is currently playing
	let isCurrentlyPlaying = $derived(
		player.currentTrack?.id === track.id && !player.paused
	);

	// URL regex pattern for linkifying comment text
	const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

	type TextSegment = { type: 'text'; content: string } | { type: 'link'; url: string };

	function parseTextWithLinks(text: string): TextSegment[] {
		const segments: TextSegment[] = [];
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		// reset regex state
		urlPattern.lastIndex = 0;

		while ((match = urlPattern.exec(text)) !== null) {
			// add text before the URL
			if (match.index > lastIndex) {
				segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
			}
			// add the URL as a link
			segments.push({ type: 'link', url: match[0] });
			lastIndex = match.index + match[0].length;
		}

		// add remaining text after the last URL
		if (lastIndex < text.length) {
			segments.push({ type: 'text', content: text.slice(lastIndex) });
		}

		return segments.length > 0 ? segments : [{ type: 'text', content: text }];
	}

	async function loadLikedState() {
		try {
			const response = await fetch(`${API_URL}/tracks/${track.id}`, {
				credentials: 'include'
			});

			if (response.ok) {
				track = await response.json();
			}
		} catch (e) {
			console.error('failed to load liked state:', e);
		}
	}

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	async function handlePlay() {
		if (player.currentTrack?.id === track.id) {
			// this track is already loaded - just toggle play/pause
			player.togglePlayPause();
		} else {
			// different track or no track - start this one
			// use playTrack for gated content checks
			if (track.gated) {
				await playTrack(track);
			} else {
				queue.playNow(track);
			}
		}
	}

	function addToQueue() {
		if (!guardGatedTrack(track, auth.isAuthenticated)) return;
		queue.addTracks([track]);
		toast.success(`queued ${track.title}`, 1800);
	}

	async function loadComments() {
		loadingComments = true;
		try {
			const response = await fetch(`${API_URL}/tracks/${track.id}/comments`);
			if (response.ok) {
				const data = await response.json();
				comments = data.comments;
				commentsEnabled = data.comments_enabled;
			} else {
				console.error('failed to load comments: response not OK');
			}
		} catch (e) {
			console.error('failed to load comments:', e);
		} finally {
			loadingComments = false;
		}
	}

	async function submitComment() {
		if (!newCommentText.trim() || submittingComment) return;

		// get current playback position (default to 0 if not playing this track)
		let timestampMs = 0;
		if (player.currentTrack?.id === track.id) {
			timestampMs = Math.floor((player.currentTime || 0) * 1000);
		}

		submittingComment = true;
		try {
			const response = await fetch(`${API_URL}/tracks/${track.id}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					text: newCommentText.trim(),
					timestamp_ms: timestampMs
				})
			});

			if (response.ok) {
				const comment = await response.json();
				// insert comment in sorted position by timestamp
				const insertIndex = comments.findIndex(c => c.timestamp_ms > comment.timestamp_ms);
				if (insertIndex === -1) {
					comments = [...comments, comment];
				} else {
					comments = [...comments.slice(0, insertIndex), comment, ...comments.slice(insertIndex)];
				}
				newCommentText = '';
				toast.success('comment added');
			} else {
				const error = await response.json();
				toast.error(error.detail || 'failed to add comment');
			}
		} catch (e) {
			console.error('failed to submit comment:', e);
			toast.error('failed to add comment');
		} finally {
			submittingComment = false;
		}
	}

	function formatTimestamp(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	async function seekToTimestamp(ms: number) {
		const doSeek = () => {
			if (player.audioElement) {
				player.audioElement.currentTime = ms / 1000;
			}
		};

		// if this track is already loaded, seek immediately
		if (player.currentTrack?.id === track.id) {
			doSeek();
			return;
		}

		// otherwise start playing and wait for audio to be ready
		// use playTrack for gated content checks
		let played = false;
		if (track.gated) {
			played = await playTrack(track);
		} else {
			queue.playNow(track);
			played = true;
		}

		if (!played) return; // gated - can't seek

		if (player.audioElement && player.audioElement.readyState >= 1) {
			doSeek();
		} else {
			// wait for metadata to load before seeking
			const onReady = () => {
				doSeek();
				player.audioElement?.removeEventListener('loadedmetadata', onReady);
			};
			player.audioElement?.addEventListener('loadedmetadata', onReady);
		}
	}

	async function copyCommentLink(timestampMs: number) {
		const seconds = Math.floor(timestampMs / 1000);
		const url = `${window.location.origin}/track/${track.id}?t=${seconds}`;
		await navigator.clipboard.writeText(url);
		toast.success('link copied');
	}

	function formatRelativeTime(isoString: string): string {
		const date = new Date(isoString);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffSecs = Math.floor(diffMs / 1000);
		const diffMins = Math.floor(diffSecs / 60);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffSecs < 60) return 'just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}

	function startEditing(comment: Comment) {
		editingCommentId = comment.id;
		editingCommentText = comment.text;
	}

	function cancelEditing() {
		editingCommentId = null;
		editingCommentText = '';
	}

	async function saveEdit(commentId: number) {
		if (!editingCommentText.trim()) return;

		try {
			const response = await fetch(`${API_URL}/tracks/comments/${commentId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ text: editingCommentText.trim() })
			});

			if (response.ok) {
				const updated = await response.json();
				comments = comments.map(c => c.id === commentId ? updated : c);
				cancelEditing();
				toast.success('comment updated');
			} else {
				const error = await response.json();
				toast.error(error.detail || 'failed to update comment');
			}
		} catch (e) {
			console.error('failed to update comment:', e);
			toast.error('failed to update comment');
		}
	}

	async function deleteComment(commentId: number) {
		try {
			const response = await fetch(`${API_URL}/tracks/comments/${commentId}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (response.ok) {
				comments = comments.filter(c => c.id !== commentId);
				toast.success('comment deleted');
			} else {
				const error = await response.json();
				toast.error(error.detail || 'failed to delete comment');
			}
		} catch (e) {
			console.error('failed to delete comment:', e);
			toast.error('failed to delete comment');
		}
	}

// track which track we've loaded data for to detect navigation
let loadedForTrackId = $state<number | null>(null);
// track if we've loaded liked state for this track (separate from general load)
let likedStateLoadedForTrackId = $state<number | null>(null);

// track if we've handled the ?t= timestamp param for this page load
let hasHandledTimestampParam = $state(false);

// reload data when navigating between track pages
// watch data.track.id (from server) not track.id (local state)
$effect(() => {
	const currentId = data.track?.id;
	if (!currentId || !browser) return;

	// check if we navigated to a different track
	if (loadedForTrackId !== currentId) {
		// reset state for new track
		comments = [];
		loadingComments = true;
		commentsEnabled = null;
		newCommentText = '';
		editingCommentId = null;
		editingCommentText = '';
		likedStateLoadedForTrackId = null; // reset liked state tracking
		hasHandledTimestampParam = false; // reset timestamp handling

		// sync track from server data
		track = data.track;

		// mark as loaded for this track
		loadedForTrackId = currentId;

		// load comments (doesn't require auth)
		void loadComments();
	}
});

// separate effect to load liked state when auth becomes available
$effect(() => {
	const currentId = data.track?.id;
	if (!currentId || !browser) return;

	// load liked state when authenticated and haven't loaded for this track yet
	if (auth.isAuthenticated && likedStateLoadedForTrackId !== currentId) {
		likedStateLoadedForTrackId = currentId;
		void loadLikedState();
	}
});

let shareUrl = $state('');

$effect(() => {
	if (typeof window !== 'undefined') {
		shareUrl = `${window.location.origin}/track/${track.id}`;
	}
});

// handle ?t= timestamp param for deep linking (youtube-style)
onMount(() => {
	const t = $page.url.searchParams.get('t');
	if (t) {
		const seconds = parseInt(t, 10);
		if (!isNaN(seconds) && seconds >= 0) {
			hasHandledTimestampParam = true;
			// small delay to ensure player is ready
			setTimeout(() => {
				void seekToTimestamp(seconds * 1000);
			}, 100);
		}
	}
});

// also handle ?t= for SPA navigation between tracks
$effect(() => {
	if (!browser || hasHandledTimestampParam) return;

	const t = $page.url.searchParams.get('t');
	if (t && track && loadedForTrackId === track.id) {
		const seconds = parseInt(t, 10);
		if (!isNaN(seconds) && seconds >= 0) {
			hasHandledTimestampParam = true;
			void seekToTimestamp(seconds * 1000);
		}
	}
});
</script>

<svelte:head>
	{#if !player.currentTrack || player.currentTrack.id === track.id}
		<title>{track.title} - {track.artist}{track.album ? ` • ${track.album.title}` : ''}</title>
	{/if}
	<meta
		name="description"
		content="{track.title} by {track.artist}{track.album ? ` from ${track.album.title}` : ''} - listen on {APP_NAME}"
	/>

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="music.song" />
	<meta property="og:title" content="{track.title} - {track.artist}" />
	<meta
		property="og:description"
		content="{track.artist}{track.album ? ` • ${track.album.title}` : ''}"
	/>
	<meta
		property="og:url"
		content={`${APP_CANONICAL_URL}/track/${track.id}`}
	/>
	<meta property="og:site_name" content={APP_NAME} />
	<meta property="music:musician" content="{track.artist_handle}" />
	{#if track.album}
		<meta property="music:album" content="{track.album.title}" />
	{/if}
	{#if track.image_url && !isImageSensitiveSSR(track.image_url)}
		<meta property="og:image" content="{track.image_url}" />
		<meta property="og:image:secure_url" content="{track.image_url}" />
		<meta property="og:image:width" content="1200" />
		<meta property="og:image:height" content="1200" />
		<meta property="og:image:alt" content="{track.title} by {track.artist}" />
	{/if}
	{#if track.r2_url}
		<meta property="og:audio" content="{track.r2_url}" />
		<meta property="og:audio:type" content="audio/{track.file_type}" />
	{/if}

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="{track.title}" />
	<meta
		name="twitter:description"
		content="{track.artist}{track.album ? ` • ${track.album.title}` : ''}"
	/>
	{#if track.image_url && !isImageSensitiveSSR(track.image_url)}
		<meta name="twitter:image" content="{track.image_url}" />
	{/if}

	<!-- oEmbed discovery for embed services like iframely -->
	<link
		rel="alternate"
		type="application/json+oembed"
		href="{API_URL}/oembed?url={encodeURIComponent(`${APP_CANONICAL_URL}/track/${track.id}`)}"
		title="{track.title} - {track.artist}"
	/>
</svelte:head>

<div class="page-container">
	{#if track.tags && track.tags.length > 0}
		<TagEffects tags={track.tags} trackTitle={track.title} />
	{/if}
	<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

	<main>
		<div class="track-detail">
			<!-- cover art -->
			<SensitiveImage src={track.image_url} tooltipPosition="center">
				<div class="cover-art-container">
					{#if track.image_url}
						<img src={track.image_url} alt="{track.title} artwork" class="cover-art" />
					{:else}
						<div class="cover-art-placeholder">
							<svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
								<path d="M9 18V5l12-2v13"></path>
								<circle cx="6" cy="18" r="3"></circle>
								<circle cx="18" cy="16" r="3"></circle>
							</svg>
						</div>
					{/if}
				</div>
			</SensitiveImage>

			<!-- track info wrapper -->
			<div class="track-info-wrapper">
				<div class="track-info">
					<h1 class="track-title">
						{track.title}
						{#if track.gated}
							<span class="gated-badge" title="supporters only">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
									<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
								</svg>
							</span>
						{/if}
					</h1>
					<div class="track-metadata">
						<a href="/u/{track.artist_handle}" class="artist-link">
							{track.artist}
						</a>
						{#if track.features && track.features.length > 0}
							<span class="separator">•</span>
							<span class="features">
								<span class="features-label">feat.</span>
								{#each track.features as feature, i}
									{#if i > 0}<span class="feature-separator">, </span>{/if}
									<a href="/u/{feature.handle}" class="feature-link">
										{feature.display_name}
									</a>
								{/each}
							</span>
						{/if}
						{#if track.album}
							<span class="separator">•</span>
							<a href="/u/{track.artist_handle}/album/{track.album.slug}" class="album album-link">
								<svg class="album-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
									<rect x="2" y="2" width="12" height="12" stroke="currentColor" stroke-width="1.5" fill="none"/>
									<circle cx="8" cy="8" r="2.5" fill="currentColor"/>
								</svg>
								<span class="album-title-text">{track.album.title}</span>
							</a>
						{/if}
					</div>

					{#if track.tags && track.tags.length > 0}
						<div class="track-tags">
							{#each track.tags as tag}
								<a href="/tag/{encodeURIComponent(tag)}" class="tag-badge">{tag}</a>
							{/each}
						</div>
					{/if}

					<div class="track-stats">
						<span class="plays">{track.play_count} {track.play_count === 1 ? 'play' : 'plays'}</span>
						{#if track.like_count && track.like_count > 0}
							<span class="separator">•</span>
							<span class="likes">{track.like_count} {track.like_count === 1 ? 'like' : 'likes'}</span>
						{/if}
					</div>

					<div class="side-buttons">
						{#if auth.isAuthenticated}
							<AddToMenu
								trackId={track.id}
								trackTitle={track.title}
								trackUri={track.atproto_record_uri}
								trackCid={track.atproto_record_cid}
								fileId={track.file_id}
								gated={track.gated}
								initialLiked={track.is_liked || false}
								shareUrl={shareUrl}
								onQueue={addToQueue}
							/>
						{/if}
						<ShareButton url={shareUrl} title="share track" />
					</div>

					<!-- actions -->
					<div class="track-actions">
						<button class="btn-play" class:playing={isCurrentlyPlaying} onclick={handlePlay}>
							{#if isCurrentlyPlaying}
								<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
									<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>
								</svg>
								pause
							{:else}
								<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
									<path d="M8 5v14l11-7z"/>
								</svg>
								play
							{/if}
						</button>
						<button class="btn-queue" onclick={addToQueue}>
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<line x1="5" y1="15" x2="5" y2="21"></line>
								<line x1="2" y1="18" x2="8" y2="18"></line>
								<line x1="9" y1="6" x2="21" y2="6"></line>
								<line x1="9" y1="12" x2="21" y2="12"></line>
								<line x1="9" y1="18" x2="21" y2="18"></line>
							</svg>
							add to queue
						</button>
					</div>
				</div>
			</div>
		</div>

		<!-- comments section - only render when we know comments are enabled -->
		{#if commentsEnabled === true}
			<section class="comments-section">
				<h2 class="comments-title">
					comments
					{#if !loadingComments && comments.length > 0}
						<span class="comment-count">({comments.length})</span>
					{/if}
				</h2>

				{#if auth.isAuthenticated}
					<form class="comment-form" onsubmit={(e) => { e.preventDefault(); submitComment(); }}>
						<input
							type="text"
							class="comment-input"
							aria-label="Add a timed comment"
							placeholder={player.currentTrack?.id === track.id ? `comment at ${formatTimestamp((player.currentTime || 0) * 1000)}...` : 'add a comment...'}
							bind:value={newCommentText}
							maxlength={300}
							disabled={submittingComment}
						/>
						<button
							type="submit"
							class="comment-submit"
							disabled={!newCommentText.trim() || submittingComment}
						>
							{submittingComment ? '...' : 'post'}
						</button>
					</form>
				{:else if !loadingComments}
					<p class="login-prompt">
						<a href="/login">log in</a> to leave a comment
					</p>
				{/if}

				<div class="comments-container">
					{#key loadingComments}
						{#if loadingComments}
							<div class="comments-list" transition:fade={{ duration: 200 }}>
								{#each [1, 2, 3] as _}
									<div class="comment skeleton">
										<div class="comment-timestamp-skeleton skeleton-bar"></div>
										<div class="comment-content">
											<div class="comment-header">
												<div class="comment-avatar-skeleton skeleton-bar"></div>
												<div class="comment-author-skeleton skeleton-bar"></div>
												<div class="comment-time-skeleton skeleton-bar"></div>
											</div>
											<div class="comment-text-skeleton skeleton-bar"></div>
										</div>
									</div>
								{/each}
							</div>
						{:else if comments.length === 0}
							<div class="no-comments" transition:fade={{ duration: 200 }}>no comments yet</div>
						{:else}
							<div class="comments-list" transition:fade={{ duration: 200 }}>
								{#each comments as comment}
									<div class="comment">
										<button
											class="comment-timestamp"
											onclick={() => seekToTimestamp(comment.timestamp_ms)}
											title="jump to {formatTimestamp(comment.timestamp_ms)}"
										>
											{formatTimestamp(comment.timestamp_ms)}
										</button>
										<div class="comment-content">
											<div class="comment-header">
												{#if comment.user_avatar_url}
													<SensitiveImage src={comment.user_avatar_url} compact>
														<img src={comment.user_avatar_url} alt="" class="comment-avatar" />
													</SensitiveImage>
												{:else}
													<div class="comment-avatar-placeholder"></div>
												{/if}
												<a href="/u/{comment.user_handle}" class="comment-author">
													{comment.user_display_name || comment.user_handle}
												</a>
												<span class="comment-separator">•</span>
												<span class="comment-time" title={new Date(comment.created_at).toLocaleString()}>
													{formatRelativeTime(comment.created_at)}{#if comment.updated_at}
														<span class="edited-indicator" title={`edited ${new Date(comment.updated_at).toLocaleString()}`}> (edited)</span>
													{/if}
												</span>
											</div>
											{#if editingCommentId === comment.id}
												<div class="comment-edit-form">
													<input
														type="text"
														class="comment-edit-input"
														bind:value={editingCommentText}
														maxlength={300}
														onkeydown={(e) => {
															if (e.key === 'Enter') saveEdit(comment.id);
															if (e.key === 'Escape') cancelEditing();
														}}
													/>
													<div class="comment-edit-actions">
														<button class="edit-form-btn save" onclick={() => saveEdit(comment.id)}>save</button>
														<button class="edit-form-btn cancel" onclick={cancelEditing}>cancel</button>
													</div>
												</div>
											{:else}
												<p class="comment-text">{#each parseTextWithLinks(comment.text) as segment}{#if segment.type === 'link'}<a href={segment.url} target="_blank" rel="noopener noreferrer" class="comment-link">{segment.url}</a>{:else}{segment.content}{/if}{/each}</p>
												<div class="comment-actions">
													<button class="comment-action-btn" onclick={() => copyCommentLink(comment.timestamp_ms)}>share</button>
													{#if auth.user?.did === comment.user_did}
														<button class="comment-action-btn" onclick={() => startEditing(comment)}>edit</button>
														<button class="comment-action-btn delete" onclick={() => deleteComment(comment.id)}>delete</button>
													{/if}
												</div>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					{/key}
				</div>
			</section>
		{/if}
	</main>
</div>

<style>
	.page-container {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		padding: 2rem;
		padding-bottom: 8rem;
		width: 100%;
	}

	.track-detail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2rem;
		width: 100%;
		max-width: 1200px;
	}

	.cover-art-container {
		width: 100%;
		max-width: 300px;
		aspect-ratio: 1;
		border-radius: var(--radius-md);
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.cover-art {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.cover-art-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		color: var(--text-muted);
	}

	.track-info-wrapper {
		width: 100%;
		max-width: 600px;
		display: flex;
		align-items: flex-start;
		justify-content: center;
	}

	.track-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		text-align: center;
	}

	.track-title {
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
		line-height: 1.2;
		text-align: center;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.gated-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
		opacity: 0.8;
	}

	.gated-badge svg {
		display: block;
	}

	.track-metadata {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		flex-wrap: wrap;
		color: var(--text-secondary);
		font-size: var(--text-xl);
	}

	.separator {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.artist-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s;
	}

	.artist-link:hover {
		color: var(--accent);
	}

	.features {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.features-label {
		color: var(--accent-hover);
		font-weight: 500;
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
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		max-width: fit-content;
	}

	.album-link {
		text-decoration: none;
		color: var(--text-tertiary);
		transition: color 0.2s;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.album-link:hover {
		color: var(--accent);
	}

	.album-title-text {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.album-icon {
		width: 16px;
		height: 16px;
		opacity: 0.7;
		flex-shrink: 0;
	}

	.track-stats {
		color: var(--text-tertiary);
		font-size: var(--text-base);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
	}

	.track-stats .separator {
		font-size: var(--text-xs);
	}

	.track-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
	}

	.tag-badge {
		display: inline-block;
		padding: 0.25rem 0.6rem;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		color: var(--accent-hover);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		font-weight: 500;
		text-decoration: none;
		transition: all 0.15s;
	}

	.tag-badge:hover {
		background: color-mix(in srgb, var(--accent) 25%, transparent);
		color: var(--accent-hover);
	}

	.side-buttons {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		align-items: center;
	}

	.track-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}

	.btn-play {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-2xl);
		font-size: var(--text-base);
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-play:hover {
		transform: scale(1.05);
		box-shadow: 0 4px 16px rgba(138, 179, 255, 0.4);
	}

	.btn-play.playing {
		animation: ethereal-glow 3s ease-in-out infinite;
	}

	.btn-queue {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: transparent;
		color: var(--text-primary);
		border: 1px solid var(--border-emphasis);
		border-radius: var(--radius-2xl);
		font-size: var(--text-base);
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-queue:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	@media (max-width: 768px) {
		main {
			padding: 0.75rem;
			padding-bottom: calc(var(--player-height, 10rem) + env(safe-area-inset-bottom, 0px));
			align-items: flex-start;
			justify-content: flex-start;
		}

		.track-detail {
			padding: 0;
			gap: 1rem;
			max-width: 100%;
		}

		.cover-art-container {
			max-width: 60%;
			margin: 0 auto;
		}

		.track-info-wrapper {
			flex-direction: column;
			align-items: center;
			gap: 0.75rem;
		}

		.track-info {
			gap: 0.75rem;
			width: 100%;
		}

		.track-title {
			font-size: var(--text-3xl);
		}

		.track-metadata {
			font-size: var(--text-base);
			gap: 0.5rem;
		}

		.track-stats {
			font-size: var(--text-sm);
		}

		.track-actions {
			flex-direction: row;
			flex-wrap: wrap;
			width: 100%;
			gap: 0.5rem;
			margin-top: 0.25rem;
			justify-content: center;
		}

		.btn-play {
			flex: 1;
			min-width: calc(50% - 0.25rem);
			justify-content: center;
			padding: 0.6rem 1rem;
			font-size: var(--text-base);
		}

		.btn-play svg {
			width: 20px;
			height: 20px;
		}

		.btn-queue {
			flex: 1;
			min-width: calc(50% - 0.25rem);
			justify-content: center;
			padding: 0.6rem 1rem;
			font-size: var(--text-base);
		}

		.btn-queue svg {
			width: 18px;
			height: 18px;
		}
	}

	/* comments section */
	.comments-section {
		width: 100%;
		max-width: 500px;
		margin: 1.5rem auto 0;
		padding-top: 1.5rem;
		border-top: 1px solid var(--border-subtle);
	}

	.comments-title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0 0 0.75rem 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.comment-count {
		color: var(--text-tertiary);
		font-weight: 400;
	}

	.comment-form {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.comment-input {
		flex: 1;
		padding: 0.6rem 0.8rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
	}

	.comment-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.comment-input::placeholder {
		color: var(--text-muted);
	}

	.comment-submit {
		padding: 0.6rem 1rem;
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		border-radius: var(--radius-base);
		font-size: var(--text-base);
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: opacity 0.2s;
	}

	.comment-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.comment-submit:hover:not(:disabled) {
		opacity: 0.9;
	}

	.login-prompt {
		color: var(--text-tertiary);
		font-size: var(--text-base);
		margin-bottom: 1rem;
	}

	.login-prompt a {
		color: var(--accent);
		text-decoration: none;
	}

	.login-prompt a:hover {
		text-decoration: underline;
	}

	.no-comments {
		color: var(--text-muted);
		font-size: var(--text-base);
		text-align: center;
		padding: 1rem;
	}

	.comments-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 300px;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--border-default) var(--bg-primary);
	}

	.comments-list::-webkit-scrollbar {
		width: 8px;
	}

	.comments-list::-webkit-scrollbar-track {
		background: var(--bg-primary);
		border-radius: var(--radius-sm);
	}

	.comments-list::-webkit-scrollbar-thumb {
		background: var(--border-default);
		border-radius: var(--radius-sm);
	}

	.comments-list::-webkit-scrollbar-thumb:hover {
		background: var(--border-emphasis);
	}

	.comment {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.5rem 0.6rem;
		background: var(--bg-tertiary);
		border-radius: var(--radius-base);
		transition: background 0.15s;
	}

	.comment:hover {
		background: var(--bg-hover);
	}

	.comment-timestamp {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		padding: 0.2rem 0.5rem;
		border-radius: var(--radius-sm);
		white-space: nowrap;
		height: fit-content;
		border: none;
		cursor: pointer;
		transition: all 0.2s;
		font-family: inherit;
	}

	.comment-timestamp:hover {
		background: color-mix(in srgb, var(--accent) 25%, transparent);
		transform: scale(1.05);
	}

	.comment-content {
		flex: 1;
		min-width: 0;
	}

	.comment-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
		flex-wrap: wrap;
	}

	.comment-separator {
		color: var(--border-emphasis);
		font-size: 0.6rem;
	}

	.comment-time {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.comment-avatar {
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		object-fit: cover;
	}

	.comment-avatar-placeholder {
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		background: var(--border-default);
	}

	.comment-author {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--text-secondary);
		text-decoration: none;
	}

	.comment-author:hover {
		color: var(--accent);
	}

	.comment-text {
		font-size: var(--text-base);
		color: var(--text-primary);
		margin: 0;
		line-height: 1.4;
		word-break: break-word;
	}

	.comment-link {
		color: var(--accent);
		text-decoration: none;
		word-break: break-all;
	}

	.comment-link:hover {
		text-decoration: underline;
	}

	.edited-indicator {
		color: var(--text-muted);
		font-style: italic;
	}

	/* actions below comment text - show on hover */
	.comment-actions {
		display: flex;
		gap: 0.75rem;
		margin-top: 0.35rem;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.comment:hover .comment-actions {
		opacity: 1;
	}

	.comment-action-btn {
		background: none;
		border: none;
		padding: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: color 0.15s;
		font-family: inherit;
	}

	.comment-action-btn:hover {
		color: var(--accent);
	}

	.comment-action-btn.delete:hover {
		color: var(--error);
	}

	/* mobile: always show actions */
	@media (hover: none) {
		.comment-actions {
			opacity: 1;
		}
	}

	.comment-edit-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}

	.comment-edit-input {
		width: 100%;
		padding: 0.5rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
	}

	.comment-edit-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.comment-edit-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.edit-form-btn {
		padding: 0.25rem 0.6rem;
		font-size: var(--text-sm);
		font-family: inherit;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s;
	}

	.edit-form-btn.save {
		background: var(--accent);
		color: var(--bg-primary);
		border: none;
		font-weight: 500;
	}

	.edit-form-btn.save:hover {
		opacity: 0.9;
	}

	.edit-form-btn.cancel {
		background: transparent;
		color: var(--text-tertiary);
		border: 1px solid var(--border-emphasis);
	}

	.edit-form-btn.cancel:hover {
		border-color: var(--text-muted);
		color: var(--text-secondary);
	}

	/* comments container prevents layout shift during transition */
	.comments-container {
		min-height: 120px;
	}

	/* skeleton loading styles for comments */
	.comment.skeleton {
		pointer-events: none;
	}

	.comment.skeleton:hover {
		background: var(--bg-tertiary);
	}

	.skeleton-bar {
		background: linear-gradient(
			90deg,
			var(--bg-tertiary) 0%,
			var(--bg-hover) 50%,
			var(--bg-tertiary) 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
		border-radius: var(--radius-sm);
	}

	.comment-timestamp-skeleton {
		width: 40px;
		height: 24px;
		flex-shrink: 0;
	}

	.comment-avatar-skeleton {
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
	}

	.comment-author-skeleton {
		width: 80px;
		height: 14px;
	}

	.comment-time-skeleton {
		width: 50px;
		height: 12px;
	}

	.comment-text-skeleton {
		width: 90%;
		height: 16px;
		margin-top: 0.25rem;
	}

	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	/* respect reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		.skeleton-bar {
			animation: none;
		}
	}

	@media (max-width: 768px) {
		.comments-section {
			margin-top: 1rem;
			padding-top: 1rem;
		}

		.comments-list {
			max-height: 200px;
		}

		.comment {
			padding: 0.5rem;
		}

		.comment-timestamp {
			font-size: var(--text-xs);
			padding: 0.15rem 0.4rem;
		}
	}
</style>
