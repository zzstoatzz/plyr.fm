<script lang="ts">
	import TrackItem from '$lib/components/TrackItem.svelte';
	import { auth } from '$lib/auth.svelte';
	import { player } from '$lib/player.svelte';
	import type { createListReorder } from '$lib/list-reorder.svelte';
	import type { PlaylistTrackCandidate } from '$lib/playlist-actions';
	import type { Track } from '$lib/types';

	interface Props {
		tracks: Track[];
		playlistId: string;
		isOwner: boolean;
		isEditMode: boolean;
		reorder: ReturnType<typeof createListReorder>;
		removingTrackId: number | null;
		addingTrackId: number | null;
		recommendations: PlaylistTrackCandidate[];
		recommendationsAvailable: boolean;
		loadingRecommendations: boolean;
		onPlayTrack: (track: Track) => void;
		onRemoveTrack: (track: Track) => void;
		onAddCandidate: (candidate: PlaylistTrackCandidate) => void;
		onRequestAdd: () => void;
	}

	let {
		tracks,
		playlistId,
		isOwner,
		isEditMode,
		reorder,
		removingTrackId,
		addingTrackId,
		recommendations,
		recommendationsAvailable,
		loadingRecommendations,
		onPlayTrack,
		onRemoveTrack,
		onAddCandidate,
		onRequestAdd
	}: Props = $props();
</script>

<div class="tracks-section">
	<h2 class="section-heading">tracks</h2>
	{#if tracks.length === 0}
		<div class="empty-state">
			<div class="empty-icon">
				<svg
					width="32"
					height="32"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
				</svg>
			</div>
			<p>no tracks yet</p>
			<span>search for tracks to add to your playlist</span>
			{#if isOwner}
				<button class="empty-add-btn" onclick={onRequestAdd}> add tracks </button>
			{/if}
		</div>
	{:else}
		<div
			class="tracks-list"
			class:edit-mode={isEditMode}
			bind:this={reorder.listElement}
			ontouchmove={isEditMode ? reorder.handleTouchMove : undefined}
			ontouchend={isEditMode ? reorder.handleTouchEnd : undefined}
			ontouchcancel={isEditMode ? reorder.handleTouchEnd : undefined}
		>
			{#each tracks as track, i (track.id)}
				{#if isEditMode}
					<div
						class="track-row"
						class:drag-over={reorder.dragOverIndex === i && reorder.touchDragIndex !== i}
						class:is-dragging={reorder.touchDragIndex === i || reorder.draggedIndex === i}
						data-index={i}
						role="listitem"
						draggable="true"
						ondragstart={(e) => reorder.handleDragStart(e, i)}
						ondragover={(e) => reorder.handleDragOver(e, i)}
						ondrop={(e) => reorder.handleDrop(e, i)}
						ondragend={reorder.handleDragEnd}
					>
						<button
							class="drag-handle"
							ontouchstart={(e) => reorder.handleTouchStart(e, i)}
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
								showIndex={true}
								isPlaying={player.currentTrack?.id === track.id}
								onPlay={onPlayTrack}
								isAuthenticated={auth.isAuthenticated}
								hideAlbum={true}
								excludePlaylistId={playlistId}
							/>
						</div>
						<button
							class="remove-track-btn"
							onclick={(e) => {
								e.stopPropagation();
								onRemoveTrack(track);
							}}
							disabled={removingTrackId === track.id}
							aria-label="remove track from playlist"
							title="remove track"
						>
							{#if removingTrackId === track.id}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="spinner"
								>
									<circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"
									></circle>
								</svg>
							{:else}
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<line x1="18" y1="6" x2="6" y2="18"></line>
									<line x1="6" y1="6" x2="18" y2="18"></line>
								</svg>
							{/if}
						</button>
					</div>
				{:else}
					<TrackItem
						{track}
						index={i}
						showIndex={true}
						isPlaying={player.currentTrack?.id === track.id}
						onPlay={onPlayTrack}
						isAuthenticated={auth.isAuthenticated}
						hideAlbum={true}
						excludePlaylistId={playlistId}
					/>
				{/if}
			{/each}
			{#if isEditMode && isOwner}
				<button class="add-track-row" onclick={onRequestAdd}>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="12" y1="5" x2="12" y2="19"></line>
						<line x1="5" y1="12" x2="19" y2="12"></line>
					</svg>
					add tracks
				</button>
				{#if recommendationsAvailable && (recommendations.length > 0 || loadingRecommendations)}
					<div class="recommendations-section">
						<div class="recommendations-header">
							<span class="recommendations-title">recommended</span>
							<span class="recommendations-subtitle">based on this playlist</span>
						</div>
						{#if loadingRecommendations && recommendations.length === 0}
							<div class="recommendations-loading">
								<span class="spinner"></span>
							</div>
						{:else}
							{#each recommendations as rec (rec.id)}
								<div class="recommendation-item">
									{#if rec.image_url}
										<img src={rec.image_url} alt="" class="rec-image" />
									{:else}
										<div class="rec-image-placeholder">
											<svg
												width="20"
												height="20"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<circle cx="12" cy="12" r="10"></circle>
												<circle cx="12" cy="12" r="3"></circle>
											</svg>
										</div>
									{/if}
									<div class="rec-info">
										<span class="rec-title">{rec.title}</span>
										<span class="rec-artist">{rec.artist_display_name}</span>
									</div>
									<button
										class="rec-add-btn"
										onclick={() => onAddCandidate(rec)}
										disabled={addingTrackId === rec.id}
										aria-label="add {rec.title} to playlist"
									>
										{#if addingTrackId === rec.id}
											<svg
												width="16"
												height="16"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												class="spinner"
											>
												<circle
													cx="12"
													cy="12"
													r="10"
													stroke-dasharray="31.4"
													stroke-dashoffset="10"
												></circle>
											</svg>
										{:else}
											<svg
												width="16"
												height="16"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<line x1="12" y1="5" x2="12" y2="19"></line>
												<line x1="5" y1="12" x2="19" y2="12"></line>
											</svg>
										{/if}
									</button>
								</div>
							{/each}
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	/* tracks section */
	.tracks-section {
		margin-top: 2rem;
		padding-bottom: calc(var(--player-height, 120px) + env(safe-area-inset-bottom, 0px));
	}

	.section-heading {
		font-size: var(--text-2xl);
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 1rem;
		text-transform: lowercase;
	}

	/* tracks list */
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
		border-radius: var(--radius-md);
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

	@media (pointer: coarse) {
		.drag-handle {
			color: var(--text-tertiary);
		}
	}

	.track-content {
		flex: 1;
		min-width: 0;
	}

	.remove-track-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s;
		flex-shrink: 0;
		width: 36px;
		height: 36px;
	}

	.remove-track-btn:hover:not(:disabled) {
		border-color: #ef4444;
		color: #ef4444;
		background: color-mix(in srgb, #ef4444 10%, transparent);
	}

	.remove-track-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.remove-track-btn .spinner {
		animation: spin 1s linear infinite;
	}

	.add-track-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		margin-top: 0.5rem;
		/* align with track cards inside .track-row */
		margin-left: calc(32px + 0.5rem);
		margin-right: calc(36px + 0.5rem);
		background: transparent;
		border: 1px dashed var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-tertiary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all 0.2s;
	}

	.add-track-row:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 5%, transparent);
	}

	/* empty state */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
	}

	.empty-icon {
		width: 64px;
		height: 64px;
		border-radius: var(--radius-xl);
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-secondary);
		color: var(--text-muted);
		margin-bottom: 1rem;
	}

	.empty-state p {
		font-size: var(--text-lg);
		font-weight: 500;
		color: var(--text-secondary);
		margin: 0 0 0.25rem 0;
	}

	.empty-state span {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin-bottom: 1.5rem;
	}

	.empty-add-btn {
		padding: 0.625rem 1.25rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.empty-add-btn:hover {
		opacity: 0.9;
	}

	/* matches the page's cascade result: both of its .spinner rules applied,
	   with the later (bordered, 0.6s) one winning the shared declarations */
	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: var(--radius-full);
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* recommendations — mirrors .track-container card style */
	.recommendations-section {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-subtle);
		/* align with track cards inside .track-row */
		margin-left: calc(32px + 0.5rem);
		margin-right: calc(36px + 0.5rem);
	}

	.recommendations-header {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.recommendations-title {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: lowercase;
	}

	.recommendations-subtitle {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.recommendations-loading {
		display: flex;
		justify-content: center;
		padding: 1rem;
	}

	/* card layout matching .track-container from TrackItem — faded to signal "suggested" */
	.recommendation-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--bg-secondary);
		border: 1px dashed var(--border-subtle);
		border-radius: var(--radius-md);
		padding: 1rem;
		opacity: 0.7;
		transition:
			opacity 0.2s ease-out,
			box-shadow 0.2s ease-out,
			background 0.15s ease-out,
			border-color 0.15s ease-out;
	}

	.recommendation-item:hover {
		opacity: 1;
		background: var(--bg-tertiary);
		border-color: color-mix(in srgb, var(--accent) 15%, var(--border-default));
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.06),
			0 0 8px color-mix(in srgb, var(--accent) 8%, transparent);
	}

	.recommendation-item:active {
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
		transition-duration: 0.08s;
	}

	.rec-image,
	.rec-image-placeholder {
		width: 48px;
		height: 48px;
		border-radius: var(--radius-base);
		flex-shrink: 0;
	}

	.rec-image {
		object-fit: cover;
	}

	.rec-image-placeholder {
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.rec-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.rec-title {
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rec-artist {
		font-size: var(--text-base);
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rec-add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s;
		flex-shrink: 0;
	}

	.rec-add-btn:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.rec-add-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	@media (max-width: 768px) {
		.recommendation-item {
			padding: 0.65rem 0.75rem;
			gap: 0.5rem;
		}

		.rec-image,
		.rec-image-placeholder {
			width: 40px;
			height: 40px;
		}

		.rec-title {
			font-size: var(--text-base);
		}

		.rec-artist {
			font-size: var(--text-sm);
		}
	}

	@media (max-width: 480px) {
		.recommendation-item {
			padding: 0.5rem 0.65rem;
		}

		.rec-image,
		.rec-image-placeholder {
			width: 36px;
			height: 36px;
		}

		.rec-title {
			font-size: var(--text-sm);
		}

		.rec-artist {
			font-size: var(--text-xs);
		}
	}
</style>
