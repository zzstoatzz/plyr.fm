<script lang="ts">
	import { queue } from '$lib/queue.svelte';
	import { goToIndex } from '$lib/playback.svelte';
	import type { Track } from '$lib/types';

	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	// touch drag state
	let touchDragIndex = $state<number | null>(null);
	let touchStartY = $state(0);
	let touchCurrentY = $state(0);
	let touchDragElement = $state<HTMLElement | null>(null);
	let queueTracksElement = $state<HTMLElement | null>(null);

	const currentTrack = $derived.by<Track | null>(() => queue.tracks[queue.currentIndex] ?? null);
	const upcoming = $derived.by<{ track: Track; index: number }[]>(() => {
		return queue.tracks
			.map((track, index) => ({ track, index }))
			.filter(({ index }) => index > queue.currentIndex);
	});

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
			queue.moveTrack(draggedIndex, index);
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
		touchCurrentY = touch.clientY;
		touchDragElement = event.currentTarget as HTMLElement;

		// add dragging class
		touchDragElement.classList.add('touch-dragging');
	}

	function handleTouchMove(event: TouchEvent) {
		if (touchDragIndex === null || !touchDragElement || !queueTracksElement) return;

		event.preventDefault();
		const touch = event.touches[0];
		touchCurrentY = touch.clientY;

		// calculate visual offset
		const offset = touchCurrentY - touchStartY;
		touchDragElement.style.transform = `translateY(${offset}px)`;

		// find which track we're hovering over
		const tracks = queueTracksElement.querySelectorAll('.queue-track');
		for (let i = 0; i < tracks.length; i++) {
			const track = tracks[i] as HTMLElement;
			const rect = track.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;

			if (touch.clientY < midY && i > 0) {
				// get the actual index from the data attribute
				const targetIndex = parseInt(track.dataset.index || '0');
				if (targetIndex !== touchDragIndex) {
					dragOverIndex = targetIndex;
				}
				break;
			} else if (touch.clientY >= midY) {
				const targetIndex = parseInt(track.dataset.index || '0');
				if (targetIndex !== touchDragIndex) {
					dragOverIndex = targetIndex;
				}
			}
		}
	}

	function handleTouchEnd() {
		if (touchDragIndex !== null && dragOverIndex !== null && touchDragIndex !== dragOverIndex) {
			queue.moveTrack(touchDragIndex, dragOverIndex);
		}

		// cleanup
		if (touchDragElement) {
			touchDragElement.classList.remove('touch-dragging');
			touchDragElement.style.transform = '';
		}

		touchDragIndex = null;
		dragOverIndex = null;
		touchDragElement = null;
	}
</script>

{#if queue.tracks.length > 0}
	<div class="queue">
		<div class="queue-header">
			<h2>queue</h2>
			{#if upcoming.length > 0}
				<button
					class="clear-btn"
					onclick={() => queue.clearUpNext()}
					title="clear upcoming tracks"
				>
					clear queue
				</button>
			{/if}
		</div>

		<div class="queue-body">
			{#if currentTrack}
				<section class="now-playing">
					<div class="section-label">now playing</div>
					<div class="now-playing-card">
						<div class="track-info">
							<div class="track-title">{currentTrack.title}</div>
							<div class="track-artist">
								<a href="/u/{currentTrack.artist_handle}">{currentTrack.artist}</a>
							</div>
						</div>

					</div>
				</section>
			{/if}

			<section class="queue-upcoming">
				<div class="section-header">
					<h3>up next</h3>
					<span>{upcoming.length}</span>
				</div>

				{#if upcoming.length > 0}
					<div
						class="queue-tracks"
						bind:this={queueTracksElement}
						ontouchmove={handleTouchMove}
						ontouchend={handleTouchEnd}
						ontouchcancel={handleTouchEnd}
					>
						{#each upcoming as { track, index } (`${track.file_id}:${index}`)}
							<div
								class="queue-track"
								class:drag-over={dragOverIndex === index && touchDragIndex !== index}
								class:is-dragging={touchDragIndex === index || draggedIndex === index}
								data-index={index}
								draggable="true"
								role="button"
								tabindex="0"
								ondragstart={(e) => handleDragStart(e, index)}
								ondragover={(e) => handleDragOver(e, index)}
								ondrop={(e) => handleDrop(e, index)}
								ondragend={handleDragEnd}
								onclick={() => goToIndex(index)}
								onkeydown={(e) => e.key === 'Enter' && goToIndex(index)}
							>
								<!-- drag handle for reordering -->
								<button
									class="drag-handle"
									ontouchstart={(e) => handleTouchStart(e, index)}
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

								<div class="track-info">
									<div class="track-title">{track.title}</div>
									<div class="track-artist">
										<a href="/u/{track.artist_handle}" onclick={(e) => e.stopPropagation()}>
											{track.artist}
										</a>
									</div>
								</div>

								<button
									class="remove-btn"
									onclick={(e) => {
										e.stopPropagation();
										queue.removeTrack(index);
									}}
									aria-label="remove from queue"
									title="remove from queue"
								>
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<line x1="18" y1="6" x2="6" y2="18"></line>
										<line x1="6" y1="6" x2="18" y2="18"></line>
									</svg>
								</button>
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-up-next">
						<span>nothing else in the queue</span>
					</div>
				{/if}
			</section>
		</div>
	</div>
{:else}
	<div class="queue empty">
		<div class="empty-state">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M9 18V5l12-2v13"></path>
				<circle cx="6" cy="18" r="3"></circle>
				<circle cx="18" cy="16" r="3"></circle>
			</svg>
			<p>queue is empty</p>
			<span>add tracks to get started</span>
		</div>
	</div>
{/if}

<style>
	.queue {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1.5rem 1.25rem calc(var(--player-height, 0px) + 40px + env(safe-area-inset-bottom, 0px));
		background: transparent;
		gap: 1rem;
	}

	.queue-header h2 {
		margin: 0;
		font-size: var(--text-lg);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--text-tertiary);
	}

	.queue-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.clear-btn {
		padding: 0.25rem 0.75rem;
		font-size: var(--text-xs);
		font-family: inherit;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: transparent;
		border: 1px solid var(--border-subtle);
		color: var(--text-tertiary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.clear-btn:hover {
		background: var(--bg-secondary);
		color: var(--text-secondary);
		border-color: var(--border-medium);
	}

	.queue-body {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		flex: 1;
		overflow: hidden;
	}

	.section-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
		margin-bottom: 0.5rem;
	}

	.now-playing-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.1rem;
		border-radius: var(--radius-md);
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		gap: 1rem;
		box-shadow: 0 0 20px color-mix(in srgb, var(--accent) 15%, transparent);
	}

	.now-playing-card .track-title {
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.35rem;
	}

	.now-playing-card .track-artist {
		font-size: var(--text-base);
		color: var(--text-secondary);
	}

	.now-playing-card .track-artist a {
		color: inherit;
		text-decoration: none;
		transition: color 0.2s;
	}

	.now-playing-card .track-artist a:hover {
		color: var(--accent);
	}


	.queue-upcoming {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		gap: 0.75rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.section-header h3 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.queue-tracks {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-right: 0.35rem;
	}

	.queue-track {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.85rem 0.9rem;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: all 0.2s;
		border: 1px solid var(--border-subtle);
		background: var(--bg-secondary);
		position: relative;
	}

	.queue-track:hover {
		background: var(--bg-hover);
		border-color: var(--border-default);
	}

	.queue-track.drag-over {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.queue-track.is-dragging {
		opacity: 0.9;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		z-index: 10;
	}

	/* applied dynamically via JS during touch drag */
	:global(.queue-track.touch-dragging) {
		z-index: 100;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem;
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: grab;
		touch-action: none;
		border-radius: var(--radius-sm);
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

	/* always show drag handle on touch devices */
	@media (pointer: coarse) {
		.drag-handle {
			color: var(--text-tertiary);
		}
	}

	.track-info {
		flex: 1;
		min-width: 0;
	}

	.track-title {
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 0.25rem;
	}

	.track-artist {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.track-artist a {
		color: inherit;
		text-decoration: none;
		transition: color 0.2s;
	}

	.track-artist a:hover {
		color: var(--text-secondary);
	}

	.remove-btn {
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		border-radius: var(--radius-sm);
		opacity: 0;
		flex-shrink: 0;
	}

	.queue-track:hover .remove-btn {
		opacity: 1;
	}

	.remove-btn:hover {
		color: var(--error);
		background: color-mix(in srgb, var(--error) 12%, transparent);
	}

	/* always show remove button on touch devices */
	@media (pointer: coarse) {
		.remove-btn {
			opacity: 1;
		}
	}

	.empty-up-next {
		border: 1px dashed var(--border-subtle);
		border-radius: var(--radius-base);
		padding: 1.25rem;
		text-align: center;
		color: var(--text-tertiary);
	}

	.queue.empty {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.empty-state {
		text-align: center;
		color: var(--text-tertiary);
		padding: 2rem;
	}

	.empty-state svg {
		margin-bottom: 1rem;
		opacity: 0.5;
	}

	.empty-state p {
		margin: 0.5rem 0 0.25rem;
		font-size: var(--text-xl);
		color: var(--text-secondary);
	}

	.empty-state span {
		font-size: var(--text-base);
	}

	.queue-tracks::-webkit-scrollbar {
		width: 8px;
	}

	.queue-tracks::-webkit-scrollbar-track {
		background: transparent;
	}

	.queue-tracks::-webkit-scrollbar-thumb {
		background: var(--border-default);
		border-radius: var(--radius-sm);
	}

	.queue-tracks::-webkit-scrollbar-thumb:hover {
		background: var(--border-emphasis);
	}
</style>
