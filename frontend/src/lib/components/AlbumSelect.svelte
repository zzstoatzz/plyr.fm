<script lang="ts">
	import type { AlbumSummary } from '$lib/types';

	interface Props {
		albums: AlbumSummary[];
		value: string;
		onSelect: (_albumTitle: string) => void;
		placeholder?: string;
		disabled?: boolean;
	}

	let { albums = [], value = $bindable(''), onSelect, placeholder = 'album name', disabled = false }: Props = $props();

	let showResults = $state(false);
	let filteredAlbums = $derived.by(() => {
		if (!value || value.length === 0) {
			return albums;
		}
		return albums.filter(album =>
			album.title.toLowerCase().includes(value.toLowerCase())
		);
	});

	let exactMatch = $derived.by(() => {
		return albums.find(a => a.title.toLowerCase() === value.toLowerCase());
	});

	let similarAlbums = $derived.by(() => {
		if (exactMatch || !value) return [];
		return albums.filter(a =>
			a.title.toLowerCase() !== value.toLowerCase() &&
			a.title.toLowerCase().includes(value.toLowerCase())
		);
	});

	function selectAlbum(albumTitle: string) {
		value = albumTitle;
		onSelect(albumTitle);
		showResults = false;
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.album-select-container')) {
			showResults = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="album-select-container">
	<div class="input-wrapper">
		<input
			type="text"
			bind:value
			placeholder={placeholder}
			{disabled}
			class="album-input"
			onfocus={() => { if (albums.length > 0) showResults = true; }}
			oninput={() => { showResults = albums.length > 0; }}
			autocomplete="off"
		/>

		{#if showResults && filteredAlbums.length > 0}
			<div class="album-results">
				{#each filteredAlbums as album}
					<button
						type="button"
						class="album-result-item"
						class:exact-match={album.title.toLowerCase() === value.toLowerCase()}
						onclick={() => selectAlbum(album.title)}
					>
						<div class="album-info">
							<div class="album-title">{album.title}</div>
							<div class="album-stats">
								{album.track_count} {album.track_count === 1 ? 'track' : 'tracks'}
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if !exactMatch && similarAlbums.length > 0}
		<p class="similar-hint">
			similar: {similarAlbums.map(a => a.title).join(', ')}
		</p>
	{/if}
</div>

<style>
	.album-select-container {
		width: 100%;
	}

	.input-wrapper {
		position: relative;
	}

	.album-input {
		width: 100%;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 1rem;
		transition: all 0.2s;
	}

	.album-input:focus {
		outline: none;
		border-color: #3a7dff;
	}

	.album-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.album-results {
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
	.album-results::-webkit-scrollbar {
		width: 8px;
	}

	.album-results::-webkit-scrollbar-track {
		background: #0a0a0a;
		border-radius: 4px;
	}

	.album-results::-webkit-scrollbar-thumb {
		background: #333;
		border-radius: 4px;
	}

	.album-results::-webkit-scrollbar-thumb:hover {
		background: #444;
	}

	/* firefox scrollbar */
	.album-results {
		scrollbar-width: thin;
		scrollbar-color: #333 #0a0a0a;
	}

	.album-result-item {
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
		cursor: pointer;
		transition: all 0.15s;
		min-width: 0;
	}

	.album-result-item:last-child {
		border-bottom: none;
	}

	.album-result-item:hover {
		background: #222;
	}

	.album-result-item.exact-match {
		background: rgba(58, 125, 255, 0.1);
		border-left: 3px solid #3a7dff;
	}

	.album-info {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.album-title {
		font-weight: 500;
		color: #e8e8e8;
		margin-bottom: 0.125rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.album-stats {
		font-size: 0.85rem;
		color: #888;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.similar-hint {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: #ff9800;
		font-style: italic;
		margin-bottom: 0;
	}

	/* mobile styles */
	@media (max-width: 768px) {
		.album-input {
			font-size: 16px; /* prevents zoom on iOS */
		}

		.album-results {
			max-height: 200px;
		}

		.album-result-item {
			padding: 0.625rem;
		}
	}
</style>
