<script lang="ts">
	import { likeTrack, unlikeTrack } from '$lib/tracks.svelte';
	import { toast } from '$lib/toast.svelte';

	interface Props {
		trackId: number;
		trackTitle: string;
		initialLiked: boolean;
		shareUrl: string;
		onQueue: () => void;
		isAuthenticated: boolean;
	}

	let { trackId, trackTitle, initialLiked, shareUrl, onQueue, isAuthenticated }: Props = $props();

	let showMenu = $state(false);
	let liked = $state(initialLiked);
	let loading = $state(false);

	// update liked state when initialLiked changes
	$effect(() => {
		liked = initialLiked;
	});

	function toggleMenu(e: Event) {
		e.stopPropagation();
		showMenu = !showMenu;
	}

	function closeMenu() {
		showMenu = false;
	}

	function handleQueue(e: Event) {
		e.stopPropagation();
		onQueue();
		closeMenu();
	}

	async function handleShare(e: Event) {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(shareUrl);
			console.log('copied to clipboard:', shareUrl);
			toast.success('link copied');
			closeMenu();
		} catch (err) {
			console.error('failed to copy:', err);
			toast.error('failed to copy link');
		}
	}

	async function handleLike(e: Event) {
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
			} else {
				// show success feedback
				if (liked) {
					toast.success(`liked ${trackTitle}`);
				} else {
					toast.info(`unliked ${trackTitle}`);
				}
			}
			closeMenu();
		} catch (e) {
			// revert on error
			liked = previousState;
			toast.error('failed to update like');
		} finally {
			loading = false;
		}
	}
</script>

<div class="actions-menu">
	<button class="menu-button" onclick={toggleMenu} title="actions">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="5" r="1"></circle>
			<circle cx="12" cy="12" r="1"></circle>
			<circle cx="12" cy="19" r="1"></circle>
		</svg>
	</button>

	{#if showMenu}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="menu-backdrop" onclick={closeMenu}></div>
		<div class="menu-panel">
			{#if isAuthenticated}
				<button class="menu-item" onclick={handleLike} disabled={loading}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
					</svg>
					<span>{liked ? 'unlike' : 'like'}</span>
				</button>
			{/if}
			<button class="menu-item" onclick={handleQueue}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<line x1="5" y1="15" x2="5" y2="21"></line>
					<line x1="2" y1="18" x2="8" y2="18"></line>
					<line x1="9" y1="6" x2="21" y2="6"></line>
					<line x1="9" y1="12" x2="21" y2="12"></line>
					<line x1="9" y1="18" x2="21" y2="18"></line>
				</svg>
				<span>add to queue</span>
			</button>
			<button class="menu-item" onclick={handleShare}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="18" cy="5" r="3"></circle>
					<circle cx="6" cy="12" r="3"></circle>
					<circle cx="18" cy="19" r="3"></circle>
					<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
					<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
				</svg>
				<span>share</span>
			</button>
		</div>
	{/if}
</div>

<style>
	.actions-menu {
		position: relative;
	}

	.menu-button {
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

	.menu-button:hover {
		background: #1a1a1a;
		border-color: var(--accent);
		color: var(--accent);
	}

	.menu-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 100;
	}

	.menu-panel {
		position: absolute;
		right: 100%;
		top: 50%;
		transform: translateY(-50%);
		margin-right: 0.5rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		z-index: 101;
		animation: slideIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
		min-width: 140px;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: transparent;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 0.75rem 1rem;
		transition: all 0.2s;
		font-family: inherit;
		width: 100%;
		text-align: left;
		border-bottom: 1px solid var(--border-subtle);
	}

	.menu-item:last-child {
		border-bottom: none;
	}

	.menu-item:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.menu-item span {
		font-size: 0.9rem;
		font-weight: 400;
		flex: 1;
	}

	.menu-item svg {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.menu-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-50%) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateY(-50%) scale(1);
		}
	}
</style>
