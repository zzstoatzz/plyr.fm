<script lang="ts">
	import { searchTracks, type PlaylistTrackCandidate } from '$lib/playlist-actions';

	interface Props {
		open: boolean;
		/** track ids already in the playlist — matching results are hidden */
		excludeTrackIds: number[];
		/** id of the candidate currently being added (shows a spinner) */
		addingTrackId: number | null;
		onAdd: (candidate: PlaylistTrackCandidate) => void;
	}

	let { open = $bindable(), excludeTrackIds, addingTrackId, onAdd }: Props = $props();

	let searchQuery = $state('');
	let searchResults = $state<PlaylistTrackCandidate[]>([]);
	let searching = $state(false);
	let searchError = $state('');

	const visibleResults = $derived.by(() => {
		const existing = new Set(excludeTrackIds);
		return searchResults.filter((r) => !existing.has(r.id));
	});

	function close() {
		open = false;
	}

	// reset search state whenever the modal closes, however it was closed
	// (backdrop, close button, or the page's Escape handler)
	$effect(() => {
		if (!open) {
			searchQuery = '';
			searchResults = [];
			searchError = '';
		}
	});

	async function runSearch() {
		if (!searchQuery.trim() || searchQuery.trim().length < 2) {
			searchResults = [];
			return;
		}

		searching = true;
		searchError = '';

		try {
			const results = await searchTracks(searchQuery);
			searchResults = results.filter((r) => r.type === 'track');
		} catch {
			searchError = 'failed to search tracks';
			searchResults = [];
		} finally {
			searching = false;
		}
	}

	// debounced search
	let searchTimeout: ReturnType<typeof setTimeout>;
	$effect(() => {
		clearTimeout(searchTimeout);
		if (searchQuery.trim().length >= 2) {
			searchTimeout = setTimeout(runSearch, 300);
		} else {
			searchResults = [];
		}
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-overlay" role="presentation" onclick={close}>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="modal search-modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="add-tracks-title"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="modal-header">
				<h3 id="add-tracks-title">add tracks</h3>
				<button class="close-btn" aria-label="close" onclick={close}>
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
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>
			<div class="search-input-wrapper">
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
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
				</svg>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="search for tracks..."
					maxlength="100"
					autofocus
				/>
				{#if searching}
					<span class="spinner"></span>
				{/if}
			</div>
			<div class="search-results">
				{#if searchError}
					<p class="error">{searchError}</p>
				{:else if visibleResults.length === 0 && searchQuery.length >= 2 && !searching}
					<p class="no-results">no tracks found</p>
				{:else}
					{#each visibleResults as result}
						<div class="search-result-item">
							{#if result.image_url}
								<img src={result.image_url} alt="" class="result-image" />
							{:else}
								<div class="result-image-placeholder">
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
										<circle cx="12" cy="12" r="10"></circle>
										<circle cx="12" cy="12" r="3"></circle>
									</svg>
								</div>
							{/if}
							<div class="result-info">
								<span class="result-title">{result.title}</span>
								<span class="result-artist">{result.artist_display_name}</span>
							</div>
							<button
								class="add-result-btn"
								onclick={() => onAdd(result)}
								disabled={addingTrackId === result.id}
							>
								{#if addingTrackId === result.id}
									<span class="spinner"></span>
								{:else}
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
								{/if}
							</button>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}

	.modal {
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		width: 100%;
		max-width: 400px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
	}

	.search-modal {
		max-width: 500px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.modal-header h3 {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.close-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.search-input-wrapper {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1.5rem;
		border-bottom: 1px solid var(--border-default);
		color: var(--text-muted);
	}

	.search-input-wrapper input {
		flex: 1;
		background: transparent;
		border: none;
		font-family: inherit;
		font-size: var(--text-lg);
		color: var(--text-primary);
		outline: none;
	}

	.search-input-wrapper input::placeholder {
		color: var(--text-muted);
	}

	.search-results {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem 0;
		max-height: 400px;
	}

	.search-results .error,
	.search-results .no-results {
		padding: 2rem 1.5rem;
		text-align: center;
		color: var(--text-muted);
		font-size: var(--text-base);
		margin: 0;
	}

	.search-results .error {
		color: #ef4444;
	}

	.search-result-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 1.5rem;
		transition: background 0.15s;
	}

	.search-result-item:hover {
		background: var(--bg-hover);
	}

	.result-image,
	.result-image-placeholder {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-base);
		flex-shrink: 0;
	}

	.result-image {
		object-fit: cover;
	}

	.result-image-placeholder {
		background: var(--bg-tertiary);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
	}

	.result-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.result-title {
		font-size: var(--text-base);
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.result-artist {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.add-result-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: var(--accent);
		border: none;
		border-radius: var(--radius-md);
		color: white;
		cursor: pointer;
		transition: all 0.15s;
		flex-shrink: 0;
	}

	.add-result-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.add-result-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

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
</style>
