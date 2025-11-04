<script lang="ts">
	import { queue } from '$lib/queue.svelte';
	import type { Track } from '$lib/types';

	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	const currentTrack = $derived.by<Track | null>(() => queue.tracks[queue.currentIndex] ?? null);
	const upcoming = $derived.by<{ track: Track; index: number }[]>(() => {
		return queue.tracks
			.map((track, index) => ({ track, index }))
			.filter(({ index }) => index > queue.currentIndex);
	});

	function handleDragStart(index: number) {
		draggedIndex = index;
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
					<div class="queue-tracks">
						{#each upcoming as { track, index } (`${track.file_id}:${index}`)}
							<div
								class="queue-track"
								class:drag-over={dragOverIndex === index}
								draggable="true"
								ondragstart={() => handleDragStart(index)}
								ondragover={(e) => handleDragOver(e, index)}
								ondrop={(e) => handleDrop(e, index)}
								ondragend={handleDragEnd}
								onclick={() => queue.goTo(index)}
							>
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
		padding: 1.5rem 1.25rem 140px;
		background: var(--bg-primary);
		border-left: 1px solid var(--border-subtle);
		gap: 1rem;
	}

	.queue-header h2 {
		margin: 0;
		font-size: 1rem;
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
		font-size: 0.75rem;
		font-family: inherit;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		background: transparent;
		border: 1px solid var(--border-subtle);
		color: var(--text-tertiary);
		border-radius: 4px;
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
		font-size: 0.75rem;
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
		border-radius: 10px;
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
		font-size: 0.9rem;
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
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.section-header h3 {
		margin: 0;
		font-size: 0.85rem;
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
		justify-content: space-between;
		padding: 0.85rem 0.9rem;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
		border: 1px solid var(--border-subtle);
		background: var(--bg-secondary);
	}

	.queue-track:hover {
		background: var(--bg-hover);
		border-color: var(--border-default);
	}

	.queue-track.drag-over {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.queue-track.current {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 14%, var(--bg-secondary));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.queue-track.current .track-title {
		color: var(--accent);
		font-weight: 600;
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
		font-size: 0.85rem;
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
		border-radius: 4px;
		opacity: 0;
	}

	.queue-track:hover .remove-btn {
		opacity: 1;
	}

	.remove-btn:hover {
		color: var(--error);
		background: color-mix(in srgb, var(--error) 12%, transparent);
	}

	.empty-up-next {
		border: 1px dashed var(--border-subtle);
		border-radius: 6px;
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
		font-size: 1.1rem;
		color: var(--text-secondary);
	}

	.empty-state span {
		font-size: 0.9rem;
	}

	.queue-tracks::-webkit-scrollbar {
		width: 8px;
	}

	.queue-tracks::-webkit-scrollbar-track {
		background: transparent;
	}

	.queue-tracks::-webkit-scrollbar-thumb {
		background: var(--border-default);
		border-radius: 4px;
	}

	.queue-tracks::-webkit-scrollbar-thumb:hover {
		background: var(--border-emphasis);
	}
</style>
