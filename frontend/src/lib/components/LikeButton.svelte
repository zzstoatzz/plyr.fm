<script lang="ts">
	import { likeTrack, unlikeTrack } from '$lib/tracks.svelte';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		trackId: number;
		trackTitle: string;
		initialLiked?: boolean;
	}

	let { trackId, trackTitle, initialLiked = false }: Props = $props();

	let liked = $state(initialLiked);
	let loading = $state(false);

	async function toggleLike(e: Event) {
		e.stopPropagation();

		if (loading) return;

		loading = true;
		const previousState = liked;

		// optimistic update
		liked = !liked;

		try {
			const success = liked
				? await likeTrack(trackId)
				: await unlikeTrack(trackId);

			if (!success) {
				// revert on failure
				liked = previousState;
				toast.error('failed to update like');
			}
		} catch (e) {
			// revert on error
			liked = previousState;
			toast.error('failed to update like');
		} finally {
			loading = false;
		}
	}
</script>

<button
	class="like-button"
	class:liked
	class:loading
	onclick={toggleLike}
	title={liked ? 'unlike' : 'like'}
	disabled={loading}
>
	<svg width="16" height="16" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
	</svg>
</button>

<style>
	.like-button {
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
	}

	.like-button:hover {
		background: #1a1a1a;
		border-color: var(--accent);
		color: var(--accent);
	}

	.like-button.liked {
		color: #ff6b9d;
		border-color: #ff6b9d;
	}

	.like-button.liked:hover {
		color: #ff4d7d;
		border-color: #ff4d7d;
		background: rgba(255, 107, 157, 0.1);
	}

	.like-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.like-button.loading {
		animation: pulse 1s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.like-button svg {
		width: 16px;
		height: 16px;
		transition: transform 0.2s;
	}

	.like-button:active:not(:disabled) svg {
		transform: scale(0.9);
	}

	@media (max-width: 768px) {
		.like-button {
			width: 28px;
			height: 28px;
		}

		.like-button svg {
			width: 14px;
			height: 14px;
		}
	}
</style>
