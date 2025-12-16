<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import TrackItem from '$lib/components/TrackItem.svelte';
	import { player } from '$lib/player.svelte';
	import { queue } from '$lib/queue.svelte';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';
	import { API_URL } from '$lib/config';
	import type { Track } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// local mutable copy of tracks for reordering
	let tracks = $state<Track[]>([...data.tracks]);

	// sync when data changes (e.g., navigation)
	$effect(() => {
		tracks = [...data.tracks];
	});

	// edit mode state
	let isEditMode = $state(false);
	let isSaving = $state(false);

	// drag state
	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	// touch drag state
	let touchDragIndex = $state<number | null>(null);
	let touchStartY = $state(0);
	let touchDragElement = $state<HTMLElement | null>(null);
	let tracksListElement = $state<HTMLElement | null>(null);

	async function handleLogout() {
		await auth.logout();
		window.location.href = '/';
	}

	function playTrack(track: Track) {
		queue.playNow(track);
	}

	function queueAll() {
		if (tracks.length === 0) return;
		queue.addTracks(tracks);
		toast.success(`queued ${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`);
	}

	function toggleEditMode() {
		if (isEditMode) {
			// exiting edit mode - save the new order
			saveOrder();
		}
		isEditMode = !isEditMode;
	}

	async function saveOrder() {
		// build strongRefs from current track order
		const items = tracks
			.filter((t) => t.atproto_record_uri && t.atproto_record_cid)
			.map((t) => ({
				uri: t.atproto_record_uri!,
				cid: t.atproto_record_cid!
			}));

		if (items.length === 0) return;

		isSaving = true;
		try {
			const response = await fetch(`${API_URL}/lists/liked/reorder`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ items })
			});

			if (!response.ok) {
				const error = await response.json().catch(() => ({ detail: 'unknown error' }));
				throw new Error(error.detail || 'failed to save order');
			}

			toast.success('order saved');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'failed to save order');
		} finally {
			isSaving = false;
		}
	}

	// move track from one index to another
	function moveTrack(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		const newTracks = [...tracks];
		const [moved] = newTracks.splice(fromIndex, 1);
		newTracks.splice(toIndex, 0, moved);
		tracks = newTracks;
	}

	// desktop drag and drop
	function handleDragStart(event: DragEvent, index: number) {
		draggedIndex = index;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragOver(event: DragEvent, index: number) {
		event.preventDefault();
		dragOverIndex = index;
	}

	function handleDrop(event: DragEvent, index: number) {
		event.preventDefault();
		if (draggedIndex !== null && draggedIndex !== index) {
			moveTrack(draggedIndex, index);
		}
		draggedIndex = null;
		dragOverIndex = null;
	}

	function handleDragEnd() {
		draggedIndex = null;
		dragOverIndex = null;
	}

	// touch drag and drop
	function handleTouchStart(event: TouchEvent, index: number) {
		const touch = event.touches[0];
		touchDragIndex = index;
		touchStartY = touch.clientY;
		touchDragElement = event.currentTarget as HTMLElement;
		touchDragElement.classList.add('touch-dragging');
	}

	function handleTouchMove(event: TouchEvent) {
		if (touchDragIndex === null || !touchDragElement || !tracksListElement) return;

		event.preventDefault();
		const touch = event.touches[0];
		const offset = touch.clientY - touchStartY;
		touchDragElement.style.transform = `translateY(${offset}px)`;

		// find which track we're hovering over
		const trackElements = tracksListElement.querySelectorAll('.track-row');
		for (let i = 0; i < trackElements.length; i++) {
			const trackEl = trackElements[i] as HTMLElement;
			const rect = trackEl.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;

			if (touch.clientY < midY && i > 0) {
				const targetIndex = parseInt(trackEl.dataset.index || '0');
				if (targetIndex !== touchDragIndex) {
					dragOverIndex = targetIndex;
				}
				break;
			} else if (touch.clientY >= midY) {
				const targetIndex = parseInt(trackEl.dataset.index || '0');
				if (targetIndex !== touchDragIndex) {
					dragOverIndex = targetIndex;
				}
			}
		}
	}

	function handleTouchEnd() {
		if (touchDragIndex !== null && dragOverIndex !== null && touchDragIndex !== dragOverIndex) {
			moveTrack(touchDragIndex, dragOverIndex);
		}

		if (touchDragElement) {
			touchDragElement.classList.remove('touch-dragging');
			touchDragElement.style.transform = '';
		}

		touchDragIndex = null;
		dragOverIndex = null;
		touchDragElement = null;
	}
</script>

<svelte:head>
	<title>liked tracks • plyr</title>
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />

<div class="page">
	<div class="section-header">
		<h2>
			liked tracks
			{#if data.tracks.length > 0}
				<span class="count">{data.tracks.length}</span>
			{/if}
		</h2>
		{#if tracks.length > 0}
			<div class="header-actions">
				<button class="queue-button" onclick={queueAll} title="add all liked tracks to queue">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
						<line x1="5" y1="15" x2="5" y2="21"></line>
						<line x1="2" y1="18" x2="8" y2="18"></line>
						<line x1="9" y1="6" x2="21" y2="6"></line>
						<line x1="9" y1="12" x2="21" y2="12"></line>
						<line x1="9" y1="18" x2="21" y2="18"></line>
					</svg>
					add to queue
				</button>
				{#if auth.isAuthenticated && tracks.length > 1}
					<button
						class="reorder-button"
						class:active={isEditMode}
						onclick={toggleEditMode}
						disabled={isSaving}
						title={isEditMode ? 'save order' : 'reorder tracks'}
					>
						{#if isEditMode}
							{#if isSaving}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinner">
									<circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle>
								</svg>
								saving...
							{:else}
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<polyline points="20 6 9 17 4 12"></polyline>
								</svg>
								done
							{/if}
						{:else}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="3" y1="12" x2="21" y2="12"></line>
								<line x1="3" y1="6" x2="21" y2="6"></line>
								<line x1="3" y1="18" x2="21" y2="18"></line>
							</svg>
							reorder
						{/if}
					</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if data.tracks.length === 0}
		<div class="empty-state">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
			</svg>
			{#if !auth.isAuthenticated}
				<h2>log in to like tracks</h2>
				<p>you need to be logged in to like tracks</p>
			{:else}
				<h2>no liked tracks yet</h2>
				<p>tracks you like will appear here</p>
			{/if}
		</div>
	{:else}
		<div
			class="tracks-list"
			class:edit-mode={isEditMode}
			bind:this={tracksListElement}
			ontouchmove={isEditMode ? handleTouchMove : undefined}
			ontouchend={isEditMode ? handleTouchEnd : undefined}
			ontouchcancel={isEditMode ? handleTouchEnd : undefined}
		>
			{#each tracks as track, i (track.id)}
				{#if isEditMode}
					<div
						class="track-row"
						class:drag-over={dragOverIndex === i && touchDragIndex !== i}
						class:is-dragging={touchDragIndex === i || draggedIndex === i}
						data-index={i}
						role="listitem"
						draggable="true"
						ondragstart={(e) => handleDragStart(e, i)}
						ondragover={(e) => handleDragOver(e, i)}
						ondrop={(e) => handleDrop(e, i)}
						ondragend={handleDragEnd}
					>
						<!-- drag handle -->
						<button
							class="drag-handle"
							ontouchstart={(e) => handleTouchStart(e, i)}
							onclick={(e) => e.stopPropagation()}
							aria-label="drag to reorder"
							title="drag to reorder"
						>
							<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
								<circle cx="5" cy="3" r="1.5"></circle>
								<circle cx="11" cy="3" r="1.5"></circle>
								<circle cx="5" cy="8" r="1.5"></circle>
								<circle cx="11" cy="8" r="1.5"></circle>
								<circle cx="5" cy="13" r="1.5"></circle>
								<circle cx="11" cy="13" r="1.5"></circle>
							</svg>
						</button>
						<div class="track-content">
							<TrackItem
								{track}
								index={i}
								isPlaying={player.currentTrack?.id === track.id && !player.paused}
								onPlay={playTrack}
								isAuthenticated={auth.isAuthenticated}
							/>
						</div>
					</div>
				{:else}
					<TrackItem
						{track}
						index={i}
						isPlaying={player.currentTrack?.id === track.id && !player.paused}
						onPlay={playTrack}
						isAuthenticated={auth.isAuthenticated}
					/>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.page {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 0px) + 2rem + env(safe-area-inset-bottom, 0px));
		min-height: 100vh;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.section-header h2 {
		font-size: var(--text-page-heading);
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.count {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-tertiary);
		background: var(--bg-tertiary);
		padding: 0.2rem 0.55rem;
		border-radius: 4px;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.queue-button,
	.reorder-button {
		padding: 0.75rem 1.5rem;
		border-radius: 24px;
		font-weight: 600;
		font-size: 0.95rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--glass-btn-bg, transparent);
		color: var(--text-primary);
		border: 1px solid var(--glass-btn-border, var(--border-default));
	}

	.queue-button:hover,
	.reorder-button:hover {
		background: var(--glass-btn-bg-hover, transparent);
		border-color: var(--accent);
		color: var(--accent);
	}

	.reorder-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.reorder-button.active {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.empty-state {
		text-align: center;
		padding: 4rem 1rem;
		color: var(--text-tertiary);
	}

	.empty-state svg {
		margin: 0 auto 1.5rem;
		color: var(--text-muted);
	}

	.empty-state h2 {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin: 0 0 0.5rem 0;
	}

	.empty-state p {
		font-size: 0.95rem;
		margin: 0;
	}

	.tracks-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* edit mode styles */
	.track-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-radius: 8px;
		transition: all 0.2s;
		position: relative;
	}

	.track-row.drag-over {
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		outline: 2px dashed var(--accent);
		outline-offset: -2px;
	}

	.track-row.is-dragging {
		opacity: 0.9;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		z-index: 10;
	}

	:global(.track-row.touch-dragging) {
		z-index: 100;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: grab;
		touch-action: none;
		border-radius: 4px;
		transition: all 0.2s;
		flex-shrink: 0;
	}

	.drag-handle:hover {
		color: var(--text-secondary);
		background: var(--bg-tertiary);
	}

	.drag-handle:active {
		cursor: grabbing;
		color: var(--accent);
	}

	@media (pointer: coarse) {
		.drag-handle {
			color: var(--text-tertiary);
		}
	}

	.track-content {
		flex: 1;
		min-width: 0;
	}

	@media (max-width: 768px) {
		.page {
			padding: 0 0.75rem calc(var(--player-height, 0px) + 1.25rem + env(safe-area-inset-bottom, 0px));
		}

		.section-header h2 {
			font-size: 1.25rem;
		}

		.count {
			font-size: 0.8rem;
			padding: 0.15rem 0.45rem;
		}

		.empty-state {
			padding: 3rem 1rem;
		}

		.empty-state h2 {
			font-size: 1.25rem;
		}

		.header-actions {
			gap: 0.75rem;
		}

		.queue-button,
		.reorder-button {
			padding: 0.6rem 1rem;
			font-size: 0.85rem;
		}

		.queue-button svg,
		.reorder-button svg {
			width: 16px;
			height: 16px;
		}
	}
</style>
