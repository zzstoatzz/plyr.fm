<script lang="ts">
	import { likeTrack, unlikeTrack } from '$lib/tracks.svelte';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		trackId: number;
		trackTitle: string;
		fileId?: string;
		gated?: boolean;
		initialLiked?: boolean;
		disabled?: boolean;
		disabledReason?: string;
		onLikeChange?: (_liked: boolean) => void;
	}

	let { trackId, trackTitle, fileId, gated, initialLiked = false, disabled = false, disabledReason, onLikeChange }: Props = $props();

	// use overridable $derived (Svelte 5.25+) - syncs with prop but can be overridden for optimistic UI
	let liked = $derived(initialLiked);
	let loading = $state(false);

	async function toggleLike(e: Event) {
		e.stopPropagation();

		if (loading || disabled) return;

		loading = true;
		const previousState = liked;

		// optimistic update
		liked = !liked;

		try {
			const success = liked
				? await likeTrack(trackId, fileId, gated)
				: await unlikeTrack(trackId);

			if (!success) {
				// revert on failure
				liked = previousState;
				toast.error('failed to update like');
			} else {
				// notify parent of like change
				onLikeChange?.(liked);

				// show success feedback
				if (liked) {
					toast.success(`liked ${trackTitle}`);
				} else {
					toast.info(`unliked ${trackTitle}`);
				}
			}
		} catch {
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
	class:disabled-state={disabled}
	onclick={toggleLike}
	title={disabled && disabledReason ? disabledReason : (liked ? 'unlike' : 'like')}
	aria-label={disabled && disabledReason ? disabledReason : (liked ? 'unlike' : 'like')}
	disabled={loading || disabled}
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
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.like-button:hover {
		background: var(--bg-tertiary);
		border-color: var(--accent);
		color: var(--accent);
	}

	.like-button.liked {
		color: var(--accent);
		border-color: var(--accent);
	}

	.like-button.liked:hover {
		color: var(--accent-hover);
		border-color: var(--accent-hover);
	}

	.like-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.like-button.disabled-state {
		opacity: 0.4;
		border-color: var(--text-muted);
		color: var(--text-muted);
	}

	.like-button.disabled-state:hover {
		background: transparent;
		border-color: var(--text-muted);
		color: var(--text-muted);
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
