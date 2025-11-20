<script lang="ts">
	import { API_URL } from '$lib/config';
	import type { FeaturedArtist } from '$lib/types';

	interface Props {
		selected: FeaturedArtist[];
		onAdd: (_artist: FeaturedArtist) => void;
		onRemove: (_did: string) => void;
		maxFeatures?: number;
		disabled?: boolean;
	}

	let { selected = $bindable([]), onAdd, onRemove, maxFeatures = 5, disabled = false }: Props = $props();

	let query = $state('');
	let results = $state<FeaturedArtist[]>([]);
	let searching = $state(false);
	let showResults = $state(false);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let noResultsFound = $state(false);

	async function searchHandles() {
		if (query.length < 2) {
			results = [];
			noResultsFound = false;
			return;
		}

		searching = true;
		noResultsFound = false;
		try {
			const response = await fetch(`${API_URL}/search/handles?q=${encodeURIComponent(query)}`);
			if (response.ok) {
				const data = await response.json();
				results = data.results;
				if (results.length === 0) {
					noResultsFound = true;
				}
				showResults = true;
			}
		} catch (_e) {
			console.error('search failed:', _e);
		} finally {
			searching = false;
		}
	}

	function handleInput() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(searchHandles, 300);
	}

	function selectArtist(artist: FeaturedArtist) {
		// check if already selected
		if (selected.some(a => a.did === artist.did)) {
			return;
		}
		// check max limit
		if (selected.length >= maxFeatures) {
			return;
		}
		onAdd(artist);
		query = '';
		results = [];
		showResults = false;
		noResultsFound = false;
	}

	function removeArtist(did: string) {
		onRemove(did);
	}

	// close dropdown when clicking outside
	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.handle-search-container')) {
			showResults = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="handle-search-container">
	<div class="search-input-wrapper">
		<input
			type="text"
			bind:value={query}
			oninput={handleInput}
			placeholder="search for artists by handle..."
			{disabled}
			class="search-input"
			onfocus={() => { if (results.length > 0) showResults = true; }}
		/>
		{#if searching}
			<span class="search-spinner">searching...</span>
		{/if}

		{#if showResults && results.length > 0}
			<div class="search-results">
				{#each results as result}
					<button
						type="button"
						class="search-result-item"
						class:selected={selected.some(a => a.did === result.did)}
						onclick={() => selectArtist(result)}
						disabled={selected.some(a => a.did === result.did) || selected.length >= maxFeatures}
					>
						{#if result.avatar_url}
							<img src={result.avatar_url} alt={result.display_name} class="result-avatar" />
						{/if}
						<div class="result-info">
							<div class="result-name">{result.display_name}</div>
							<div class="result-handle">@{result.handle}</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}

		{#if noResultsFound && query.length >= 2}
			<div class="no-results-message">
				no artist found with handle "{query}"
			</div>
		{/if}
	</div>

	{#if selected.length > 0}
		<div class="selected-artists">
			{#each selected as artist}
				<div class="selected-artist-chip">
					{#if artist.avatar_url}
						<img src={artist.avatar_url} alt={artist.display_name} class="chip-avatar" />
					{/if}
					<span class="chip-name">{artist.display_name}</span>
					<button
						type="button"
						class="chip-remove"
						onclick={() => removeArtist(artist.did)}
						title="remove"
						{disabled}
					>
						×
					</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if selected.length >= maxFeatures}
		<div class="max-features-message">
			maximum {maxFeatures} featured artists
		</div>
	{/if}
</div>

<style>
	.handle-search-container {
		width: 100%;
	}

	.search-input-wrapper {
		position: relative;
	}

	.search-input {
		width: 100%;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 1rem;
		font-family: inherit;
		transition: all 0.2s;
	}

	.search-input:focus {
		outline: none;
		border-color: #3a7dff;
	}

	.search-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.search-spinner {
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: 0.85rem;
		color: #666;
	}

	.search-results {
		position: absolute;
		z-index: 100;
		width: 100%;
		max-height: 300px;
		overflow-y: auto;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 4px;
		margin-top: 0.25rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
	}

	/* custom scrollbar styling */
	.search-results::-webkit-scrollbar {
		width: 8px;
	}

	.search-results::-webkit-scrollbar-track {
		background: #0a0a0a;
		border-radius: 4px;
	}

	.search-results::-webkit-scrollbar-thumb {
		background: #333;
		border-radius: 4px;
	}

	.search-results::-webkit-scrollbar-thumb:hover {
		background: #444;
	}

	/* firefox scrollbar */
	.search-results {
		scrollbar-width: thin;
		scrollbar-color: #333 #0a0a0a;
	}

	.search-result-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid #2a2a2a;
		color: white;
		text-align: left;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
		min-width: 0; /* allow flex child to shrink */
	}

	.search-result-item:last-child {
		border-bottom: none;
	}

	.search-result-item:hover:not(:disabled) {
		background: #222;
	}

	.search-result-item.selected,
	.search-result-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.result-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid #333;
		flex-shrink: 0;
	}

	.result-info {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.result-name {
		font-weight: 500;
		color: #e8e8e8;
		margin-bottom: 0.125rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.result-handle {
		font-size: 0.85rem;
		color: #888;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.selected-artists {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.selected-artist-chip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: #1a2330;
		border: 1px solid #2a3a4a;
		border-radius: 20px;
		color: #e8e8e8;
		font-size: 0.9rem;
	}

	.chip-avatar {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid #333;
	}

	.chip-name {
		font-weight: 500;
	}

	.chip-remove {
		background: transparent;
		border: none;
		color: #888;
		font-size: 1.3rem;
		font-family: inherit;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.2s;
	}

	.chip-remove:hover:not(:disabled) {
		color: #ff6b6b;
	}

	.chip-remove:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.max-features-message {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: #ff9966;
	}

	.no-results-message {
		margin-top: 0.5rem;
		padding: 0.75rem;
		background: #2a1a1a;
		border: 1px solid #4a3030;
		border-radius: 4px;
		color: #ff9966;
		font-size: 0.9rem;
		text-align: center;
	}

	/* mobile styles */
	@media (max-width: 768px) {
		.search-input {
			font-size: 16px; /* prevents zoom on iOS */
		}

		.search-results {
			max-height: 200px;
		}

		.search-result-item {
			padding: 0.625rem;
		}

		.result-avatar {
			width: 32px;
			height: 32px;
		}

		.selected-artist-chip {
			padding: 0.4rem 0.6rem;
			font-size: 0.85rem;
		}

		.chip-avatar {
			width: 20px;
			height: 20px;
		}
	}
</style>
