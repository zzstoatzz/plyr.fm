<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import BottomSheet from '$lib/components/BottomSheet.svelte';
	import { API_URL } from '$lib/config';
	import { playTrack } from '$lib/playback.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { toast } from '$lib/toast.svelte';
	import type { Track } from '$lib/types';
	import { fade } from 'svelte/transition';
	import RichText from '$lib/components/RichText.svelte';
	import SensitiveImage from '$lib/components/SensitiveImage.svelte';
	import { redirectToLogin } from '$lib/utils/auth-redirect';

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

	let { track }: { track: Track } = $props();

	// comments state - assume enabled until we know otherwise
	let comments = $state<Comment[]>([]);
	let commentsEnabled = $state<boolean | null>(null); // null = unknown, true/false = known
	let commentsOpen = $state(false);
	let loadingComments = $state(true);
	let commentCount = $derived(loadingComments ? (track.comment_count ?? 0) : comments.length);
	let newCommentText = $state('');
	let submittingComment = $state(false);
	let editingCommentId = $state<number | null>(null);
	let editingCommentText = $state('');


	// reload + reset whenever the track changes (SPA navigation reuses this)
	$effect(() => {
		void track.id;
		comments = [];
		commentsEnabled = null;
		commentsOpen = false;
		newCommentText = '';
		editingCommentId = null;
		editingCommentText = '';
		void loadComments();
	});

	async function loadComments() {
		loadingComments = true;
		try {
			const response = await fetch(`${API_URL}/tracks/${track.id}/comments`, {
				credentials: 'include'
			});
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
			queue.seek(ms);
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
</script>

<!-- a quiet utility trigger (icon + count) for the page's share/download
     row; the full section opens as a bottom sheet on every viewport -->
{#if commentsEnabled === true}
	<button
		class="comments-trigger"
		onclick={() => (commentsOpen = true)}
		aria-haspopup="dialog"
		title="comments"
	>
		<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
		</svg>
		{#if commentCount > 0}
			<span class="comments-trigger-count">{commentCount}</span>
		{/if}
	</button>
			<BottomSheet
				open={commentsOpen}
				onClose={() => (commentsOpen = false)}
				ariaLabel="comments"
				maxWidth="520px"
				maxHeight="70vh"
			>
			<section class="comments-section">
				<h2 class="comments-title">
					comments
					{#if !loadingComments && comments.length > 0}
						<span class="comment-count">({comments.length})</span>
					{/if}
				</h2>

				{#if auth.isAuthenticated}
					<form class="comment-form" onsubmit={(e) => { e.preventDefault(); submitComment(); }}>
						<div class="comment-input-wrapper">
							<input
								type="text"
								class="comment-input"
								aria-label="Add a timed comment"
								placeholder={player.currentTrack?.id === track.id ? `comment at ${formatTimestamp((player.currentTime || 0) * 1000)}...` : 'add a comment...'}
								bind:value={newCommentText}
								maxlength={1000}
								disabled={submittingComment}
							/>
							{#if newCommentText.length > 0}
								<span class="comment-char-count">{newCommentText.length} / 1000</span>
							{/if}
						</div>
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
						<a href="/login" onclick={(e) => { e.preventDefault(); redirectToLogin(); }}>sign in</a> to leave a comment
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
														maxlength={1000}
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
												<p class="comment-text"><RichText text={comment.text} /></p>
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
			</BottomSheet>
		{/if}

<style>
	/* quiet utility trigger — sits in the page's share/download row */
	.comments-trigger {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem;
		background: transparent;
		border: none;
		border-radius: var(--radius-full);
		color: var(--text-tertiary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all 0.15s;
	}

	.comments-trigger:hover {
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.comments-trigger-count {
		font-variant-numeric: tabular-nums;
	}

	.comments-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
		padding: 0.75rem 1.25rem 1.25rem;
		text-align: left;
	}

	.comments-title {
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
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
	}

	.comment-input-wrapper {
		flex: 1;
		position: relative;
	}

	.comment-input {
		width: 100%;
		padding: 0.6rem 0.8rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-size: var(--text-base);
		font-family: inherit;
	}

	.comment-char-count {
		position: absolute;
		right: 0.5rem;
		top: -1.25rem;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
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
		padding: 0.5rem 1rem 0.75rem;
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
		min-height: 0;
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
