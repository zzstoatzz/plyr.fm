<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { search, type SearchResult } from '$lib/search.svelte';
	import { fade } from 'svelte/transition';
	import { onMount, onDestroy } from 'svelte';

	let inputRef: HTMLInputElement | null = $state(null);

	// focus input when modal opens
	$effect(() => {
		if (search.isOpen && inputRef && browser) {
			// small delay to ensure modal is rendered
			window.requestAnimationFrame(() => {
				inputRef?.focus();
			});
		}
	});

	function handleKeydown(event: KeyboardEvent) {
		if (!search.isOpen) return;

		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				search.close();
				break;
			case 'ArrowDown':
				event.preventDefault();
				search.selectNext();
				break;
			case 'ArrowUp':
				event.preventDefault();
				search.selectPrevious();
				break;
			case 'Enter': {
				event.preventDefault();
				const selected = search.getSelectedResult();
				if (selected) {
					navigateToResult(selected);
				}
				break;
			}
		}
	}

	function navigateToResult(result: SearchResult) {
		const href = search.getResultHref(result);
		search.close();
		goto(href);
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			search.close();
		}
	}

	function getResultIcon(type: SearchResult['type']): string {
		switch (type) {
			case 'track':
				return '♪';
			case 'artist':
				return '◉';
			case 'album':
				return '◫';
			case 'tag':
				return '#';
		}
	}

	function getResultImage(result: SearchResult): string | null {
		switch (result.type) {
			case 'track':
				return result.image_url;
			case 'artist':
				return result.avatar_url;
			case 'album':
				return result.image_url;
			case 'tag':
				return null;
		}
	}

	function getResultTitle(result: SearchResult): string {
		switch (result.type) {
			case 'track':
				return result.title;
			case 'artist':
				return result.display_name;
			case 'album':
				return result.title;
			case 'tag':
				return result.name;
		}
	}

	function getResultSubtitle(result: SearchResult): string {
		switch (result.type) {
			case 'track':
				return `by ${result.artist_display_name}`;
			case 'artist':
				return `@${result.handle}`;
			case 'album':
				return `by ${result.artist_display_name}`;
			case 'tag':
				return `${result.track_count} track${result.track_count === 1 ? '' : 's'}`;
		}
	}

	function getShortcutHint(): string {
		// detect platform - use text instead of symbols for clarity
		if (browser && navigator.platform.toLowerCase().includes('mac')) {
			return 'Cmd+K';
		}
		return 'Ctrl+K';
	}

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('keydown', handleKeydown);
		}
	});
</script>

{#if search.isOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="search-backdrop"
		onclick={handleBackdropClick}
		transition:fade={{ duration: 150 }}
	>
		<div class="search-modal" role="dialog" aria-modal="true" aria-label="search">
			<div class="search-input-wrapper">
				<svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
				</svg>
				<input
					bind:this={inputRef}
					type="text"
					class="search-input"
					placeholder="search tracks, artists, albums, tags..."
					value={search.query}
					oninput={(e) => search.setQuery(e.currentTarget.value)}
					autocomplete="off"
					autocorrect="off"
					autocapitalize="off"
					spellcheck="false"
				/>
				{#if search.loading}
					<div class="search-spinner"></div>
				{:else}
					<kbd class="search-shortcut">{getShortcutHint()}</kbd>
				{/if}
			</div>

			{#if search.results.length > 0}
				<div class="search-results">
					{#each search.results as result, index (result.type + '-' + (result.type === 'track' ? result.id : result.type === 'artist' ? result.did : result.type === 'album' ? result.id : result.id))}
						{@const imageUrl = getResultImage(result)}
						<button
							class="search-result"
							class:selected={index === search.selectedIndex}
							onclick={() => navigateToResult(result)}
							onmouseenter={() => (search.selectedIndex = index)}
						>
							<span class="result-icon" data-type={result.type}>
								{#if imageUrl}
									<img
										src={imageUrl}
										alt=""
										class="result-image"
										loading="lazy"
										onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
									/>
									<span class="result-icon-fallback">{getResultIcon(result.type)}</span>
								{:else}
									{getResultIcon(result.type)}
								{/if}
							</span>
							<div class="result-content">
								<span class="result-title">{getResultTitle(result)}</span>
								<span class="result-subtitle">{getResultSubtitle(result)}</span>
							</div>
							<span class="result-type">{result.type}</span>
						</button>
					{/each}
				</div>
			{:else if search.query.length >= 2 && !search.loading}
				<div class="search-empty">
					no results for "{search.query}"
				</div>
			{:else if search.query.length === 0}
				<div class="search-hints">
					<p>start typing to search across all content</p>
					<div class="hint-shortcuts">
						<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
						<span><kbd>↵</kbd> select</span>
						<span><kbd>esc</kbd> close</span>
					</div>
				</div>
			{/if}

			{#if search.error}
				<div class="search-error">{search.error}</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.search-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 9999;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 15vh;
	}

	.search-modal {
		width: 100%;
		max-width: 560px;
		background: rgba(18, 18, 20, 0.85);
		backdrop-filter: blur(20px) saturate(180%);
		-webkit-backdrop-filter: blur(20px) saturate(180%);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 16px;
		box-shadow:
			0 24px 80px rgba(0, 0, 0, 0.5),
			0 0 1px rgba(255, 255, 255, 0.1) inset;
		overflow: hidden;
		margin: 0 1rem;
	}

	.search-input-wrapper {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		background: rgba(255, 255, 255, 0.02);
	}

	.search-icon {
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		font-size: 1rem;
		font-family: inherit;
		color: var(--text-primary);
	}

	.search-input::placeholder {
		color: var(--text-muted);
	}

	.search-shortcut {
		font-size: 0.7rem;
		padding: 0.25rem 0.5rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 5px;
		color: var(--text-muted);
		font-family: inherit;
	}

	.search-spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--border-default);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.search-results {
		max-height: 400px;
		overflow-y: auto;
		padding: 0.5rem;
	}

	.search-result {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem;
		background: transparent;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		color: var(--text-primary);
		transition: background 0.1s;
	}

	.search-result:hover,
	.search-result.selected {
		background: rgba(255, 255, 255, 0.06);
	}

	.search-result.selected {
		background: rgba(255, 255, 255, 0.08);
		box-shadow: 0 0 0 1px rgba(var(--accent-rgb, 255, 107, 107), 0.3) inset;
	}

	.result-icon {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 8px;
		font-size: 0.9rem;
		flex-shrink: 0;
		position: relative;
		overflow: hidden;
	}

	.result-image {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 8px;
	}

	.result-icon-fallback {
		/* shown behind image, visible if image fails */
		position: relative;
		z-index: 0;
	}

	.result-image + .result-icon-fallback {
		/* hide fallback when image is present and loaded */
		opacity: 0;
	}

	.result-icon[data-type='track'] {
		color: var(--accent);
	}

	.result-icon[data-type='artist'] {
		color: #a78bfa;
	}

	.result-icon[data-type='album'] {
		color: #34d399;
	}

	.result-icon[data-type='tag'] {
		color: #fbbf24;
	}

	.result-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.result-title {
		font-size: 0.9rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.result-subtitle {
		font-size: 0.75rem;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.result-type {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-muted);
		padding: 0.2rem 0.45rem;
		background: rgba(255, 255, 255, 0.04);
		border-radius: 4px;
		flex-shrink: 0;
	}

	.search-empty {
		padding: 2rem;
		text-align: center;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}

	.search-hints {
		padding: 1.5rem 2rem;
		text-align: center;
	}

	.search-hints p {
		margin: 0 0 1rem 0;
		color: var(--text-secondary);
		font-size: 0.85rem;
	}

	.hint-shortcuts {
		display: flex;
		justify-content: center;
		gap: 1.5rem;
		color: var(--text-muted);
		font-size: 0.75rem;
	}

	.hint-shortcuts span {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.hint-shortcuts kbd {
		font-size: 0.65rem;
		padding: 0.15rem 0.35rem;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 4px;
		font-family: inherit;
	}

	.search-error {
		padding: 1rem;
		text-align: center;
		color: var(--error);
		font-size: 0.85rem;
	}

	/* mobile optimizations */
	@media (max-width: 768px) {
		.search-backdrop {
			padding-top: 10vh;
		}

		.search-modal {
			margin: 0 0.75rem;
			max-height: 80vh;
		}

		.search-input-wrapper {
			padding: 0.875rem 1rem;
		}

		.search-input {
			font-size: 16px; /* prevents iOS zoom */
		}

		.search-results {
			max-height: 60vh;
		}

		.hint-shortcuts {
			flex-wrap: wrap;
			gap: 1rem;
		}
	}

	/* respect reduced motion */
	@media (prefers-reduced-motion: reduce) {
		.search-spinner {
			animation: none;
		}
	}
</style>
