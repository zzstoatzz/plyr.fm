<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { search, type SearchResult } from '$lib/search.svelte';
	import { onMount, onDestroy } from 'svelte';
	import SensitiveImage from './SensitiveImage.svelte';

	let inputRef: HTMLInputElement | null = $state(null);
	let isMobile = $state(false);

	// detect mobile on mount
	$effect(() => {
		if (browser) {
			const checkMobile = () => window.matchMedia('(max-width: 768px)').matches;
			isMobile = checkMobile();
			const mediaQuery = window.matchMedia('(max-width: 768px)');
			const handler = (e: MediaQueryListEvent) => (isMobile = e.matches);
			mediaQuery.addEventListener('change', handler);
			return () => mediaQuery.removeEventListener('change', handler);
		}
	});

	// register input ref with search state for direct focus (mobile keyboard fix)
	$effect(() => {
		if (inputRef) {
			search.setInputRef(inputRef);
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
			case 'playlist':
				return result.image_url;
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
			case 'playlist':
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
			case 'playlist':
				return `by ${result.owner_display_name} · ${result.track_count} track${result.track_count === 1 ? '' : 's'}`;
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

<!-- always render for mobile keyboard focus, use CSS to show/hide -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="search-backdrop"
	class:open={search.isOpen}
	onclick={handleBackdropClick}
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
					placeholder="search tracks, artists, albums, playlists..."
					value={search.query}
					oninput={(e) => search.setQuery(e.currentTarget.value)}
					autocomplete="off"
					autocorrect="off"
					autocapitalize="off"
					spellcheck="false"
				/>
				{#if search.loading}
					<div class="search-spinner"></div>
				{:else if !isMobile}
					<kbd class="search-shortcut">{getShortcutHint()}</kbd>
				{/if}
			</div>

			{#if search.results.length > 0}
				<div class="search-results">
					{#each search.results as result, index (result.type + '-' + (result.type === 'track' ? result.id : result.type === 'artist' ? result.did : result.type === 'album' ? result.id : result.type === 'playlist' ? result.id : result.id))}
						{@const imageUrl = getResultImage(result)}
						<button
							class="search-result"
							class:selected={index === search.selectedIndex}
							onclick={() => navigateToResult(result)}
							onmouseenter={() => (search.selectedIndex = index)}
						>
							<span class="result-icon" data-type={result.type}>
								{#if imageUrl}
									<SensitiveImage src={imageUrl} compact>
										<img
											src={imageUrl}
											alt=""
											class="result-image"
											loading="lazy"
										/>
									</SensitiveImage>
								{:else if result.type === 'track'}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
										<path d="M9 18V5l12-2v13"></path>
										<circle cx="6" cy="18" r="3"></circle>
										<circle cx="18" cy="16" r="3"></circle>
									</svg>
								{:else if result.type === 'artist'}
									<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
										<circle cx="8" cy="5" r="3" fill="none" />
										<path d="M3 14c0-2.5 2-4.5 5-4.5s5 2 5 4.5" stroke-linecap="round" />
									</svg>
								{:else if result.type === 'album'}
									<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
										<rect x="2" y="2" width="12" height="12" fill="none" />
										<circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
									</svg>
								{:else if result.type === 'tag'}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
										<line x1="7" y1="7" x2="7.01" y2="7"></line>
									</svg>
								{:else if result.type === 'playlist'}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
										<line x1="8" y1="6" x2="21" y2="6"></line>
										<line x1="8" y1="12" x2="21" y2="12"></line>
										<line x1="8" y1="18" x2="21" y2="18"></line>
										<line x1="3" y1="6" x2="3.01" y2="6"></line>
										<line x1="3" y1="12" x2="3.01" y2="12"></line>
										<line x1="3" y1="18" x2="3.01" y2="18"></line>
									</svg>
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
					{#if !isMobile}
						<div class="hint-shortcuts">
							<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
							<span><kbd>↵</kbd> select</span>
							<span><kbd>esc</kbd> close</span>
						</div>
					{/if}
				</div>
			{/if}

			{#if search.error}
				<div class="search-error">{search.error}</div>
			{/if}
		</div>
	</div>

<style>
	.search-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 9999;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 15vh;
		/* hidden by default - use opacity only (not visibility) so input remains focusable for mobile keyboard */
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s;
	}

	.search-backdrop.open {
		opacity: 1;
		pointer-events: auto;
	}

	.search-modal {
		width: 100%;
		max-width: 560px;
		background: color-mix(in srgb, var(--bg-secondary) 95%, transparent);
		backdrop-filter: blur(20px) saturate(180%);
		-webkit-backdrop-filter: blur(20px) saturate(180%);
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		box-shadow:
			0 24px 80px color-mix(in srgb, var(--bg-primary) 50%, transparent),
			0 0 1px var(--border-subtle) inset;
		overflow: hidden;
		margin: 0 1rem;
	}

	.search-input-wrapper {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-tertiary) 50%, transparent);
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
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
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
		scrollbar-width: thin;
		scrollbar-color: var(--border-default) transparent;
	}

	.search-results::-webkit-scrollbar {
		width: 8px;
	}

	.search-results::-webkit-scrollbar-track {
		background: transparent;
		border-radius: 4px;
	}

	.search-results::-webkit-scrollbar-thumb {
		background: var(--border-default);
		border-radius: 4px;
	}

	.search-results::-webkit-scrollbar-thumb:hover {
		background: var(--border-emphasis);
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
		background: var(--bg-hover);
	}

	.search-result.selected {
		background: var(--bg-hover);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent) inset;
	}

	.result-icon {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-tertiary);
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

	.result-icon[data-type='playlist'] {
		color: #f472b6;
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
		background: var(--bg-tertiary);
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
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
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

		.search-input::placeholder {
			font-size: 0.85rem;
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
