<script lang="ts">
	import { tracksCache } from '$lib/tracks.svelte';
	import { auth } from '$lib/auth.svelte';
	import { preferences } from '$lib/preferences.svelte';
	import { API_URL } from '$lib/config';

	interface TagSuggestion {
		name: string;
		track_count: number;
	}

	let isExpanded = $state(false);
	let addingTag = $state(false);
	let newTag = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	// autocomplete state
	let suggestions = $state<TagSuggestion[]>([]);
	let showSuggestions = $state(false);
	let selectedIndex = $state(-1);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	// derive hidden tags from preferences store
	let hiddenTags = $derived(preferences.data?.hidden_tags ?? []);

	async function searchTags(query: string) {
		if (!query.trim()) {
			suggestions = [];
			showSuggestions = false;
			return;
		}
		try {
			const res = await fetch(`${API_URL}/tracks/tags?q=${encodeURIComponent(query.trim())}&limit=10`);
			if (!res.ok) return;
			const data: TagSuggestion[] = await res.json();
			suggestions = data.filter((t) => !hiddenTags.includes(t.name));
			showSuggestions = suggestions.length > 0;
			selectedIndex = -1;
		} catch {
			suggestions = [];
			showSuggestions = false;
		}
	}

	function handleInput() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchTags(newTag);
		}, 200);
	}

	function clearSuggestions() {
		suggestions = [];
		showSuggestions = false;
		selectedIndex = -1;
		if (searchTimeout) {
			clearTimeout(searchTimeout);
			searchTimeout = null;
		}
	}

	async function removeTag(tag: string) {
		const updated = hiddenTags.filter((t) => t !== tag);
		await preferences.update({ hidden_tags: updated });
		tracksCache.invalidate();
		tracksCache.fetch(true);
	}

	async function addTag(tag: string) {
		const normalized = tag.trim().toLowerCase();
		// clear input state immediately to avoid visual duplication
		newTag = '';
		addingTag = false;
		clearSuggestions();

		if (normalized && !hiddenTags.includes(normalized)) {
			const updated = [...hiddenTags, normalized];
			await preferences.update({ hidden_tags: updated });
			tracksCache.invalidate();
			tracksCache.fetch(true);
		}
	}

	function pickSuggestion(tag: TagSuggestion) {
		addTag(tag.name);
	}

	function handleSuggestionMousedown(e: MouseEvent, tag: TagSuggestion) {
		e.preventDefault();
		pickSuggestion(tag);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (showSuggestions && suggestions.length > 0) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				selectedIndex = selectedIndex < suggestions.length - 1 ? selectedIndex + 1 : 0;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : suggestions.length - 1;
				return;
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
					pickSuggestion(suggestions[selectedIndex]);
				} else {
					addTag(newTag);
				}
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				clearSuggestions();
				return;
			}
		} else {
			if (e.key === 'Enter') {
				e.preventDefault();
				addTag(newTag);
				return;
			}
			if (e.key === 'Escape') {
				addingTag = false;
				newTag = '';
				clearSuggestions();
				return;
			}
		}
	}

	function handleBlur() {
		// delay to allow click on suggestion to fire first
		setTimeout(() => {
			if (!newTag.trim()) addingTag = false;
			clearSuggestions();
		}, 150);
	}

	function toggleExpanded() {
		isExpanded = !isExpanded;
		if (!isExpanded) {
			addingTag = false;
			newTag = '';
			clearSuggestions();
		}
	}

	function startAddingTag() {
		addingTag = true;
		clearSuggestions();
		setTimeout(() => inputEl?.focus(), 0);
	}
</script>

{#if auth.isAuthenticated && preferences.data !== null}
	<div class="filter-bar">
		<button
			type="button"
			class="filter-toggle"
			class:has-filters={hiddenTags.length > 0}
			onclick={toggleExpanded}
			title={isExpanded ? 'collapse filters' : 'show hidden tag filters'}
		>
			<svg class="eye-icon" viewBox="0 0 24 24" fill="none">
				{#if hiddenTags.length > 0}
					<!-- closed/hidden eye -->
					<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
					<circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>
					<circle cx="12" cy="12" r="1.5" fill="currentColor" opacity="0.4"/>
					<line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				{:else}
					<!-- open all-seeing eye -->
					<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.5"/>
					<circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="1.5"/>
					<circle cx="12" cy="12" r="1.5" fill="currentColor"/>
					<!-- subtle rays -->
					<path d="M12 2v2M12 20v2M4.5 4.5l1.5 1.5M18 18l1.5 1.5M2 12h2M20 12h2M4.5 19.5l1.5-1.5M18 6l1.5-1.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.3"/>
				{/if}
			</svg>
			{#if hiddenTags.length > 0 && !isExpanded}
				<span class="filter-count">{hiddenTags.length}</span>
			{/if}
		</button>

		{#if isExpanded}
			<div class="tags-row">
				{#if hiddenTags.length > 0}
					<span class="filter-label">hiding:</span>
				{/if}
				{#each hiddenTags as tag (tag)}
					<button type="button" class="tag-chip" onclick={() => removeTag(tag)} title="unhide '{tag}'">
						{tag}
						<span class="remove-icon">&times;</span>
					</button>
				{/each}

				{#if addingTag}
					<div class="input-wrapper" class:has-suggestions={showSuggestions}>
						<input
							bind:this={inputEl}
							type="text"
							bind:value={newTag}
							onkeydown={handleKeydown}
							oninput={handleInput}
							onblur={handleBlur}
							placeholder="tag"
							class="add-input"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
						/>
						{#if showSuggestions}
							<ul class="suggestions" role="listbox">
								{#each suggestions as suggestion, i (suggestion.name)}
									<li
										role="option"
										aria-selected={i === selectedIndex}
										class="suggestion-item"
										class:selected={i === selectedIndex}
										onmousedown={(e) => handleSuggestionMousedown(e, suggestion)}
										onmouseenter={() => { selectedIndex = i; }}
									>
										<span class="suggestion-name">{suggestion.name}</span>
										<span class="suggestion-count">{suggestion.track_count}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{:else}
					<button type="button" class="add-btn" onclick={startAddingTag} title="hide a tag">
						+
					</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.filter-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		font-size: var(--text-sm);
	}

	.filter-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.35rem;
		background: var(--glass-btn-bg, transparent);
		border: 1px solid var(--glass-btn-border, transparent);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.15s;
		border-radius: var(--radius-base);
	}

	.filter-toggle:hover {
		color: var(--text-secondary);
		background: var(--glass-btn-bg-hover, var(--bg-hover, transparent));
	}

	.filter-toggle.has-filters {
		color: var(--text-secondary);
	}

	.eye-icon {
		width: 18px;
		height: 18px;
	}

	.filter-count {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.filter-label {
		color: var(--text-tertiary);
		white-space: nowrap;
		font-size: var(--text-xs);
		font-family: inherit;
	}

	.tags-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.2rem 0.4rem;
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
		min-height: 24px;
	}

	.tag-chip:hover {
		border-color: color-mix(in srgb, var(--error) 50%, transparent);
		color: var(--error);
	}

	.tag-chip:active {
		transform: scale(0.97);
	}

	.remove-icon {
		font-size: var(--text-sm);
		line-height: 1;
		opacity: 0.5;
	}

	.tag-chip:hover .remove-icon {
		opacity: 1;
	}

	.add-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		border: 1px dashed var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all 0.15s;
	}

	.add-btn:hover {
		border-color: var(--text-tertiary);
		color: var(--text-secondary);
	}

	.input-wrapper {
		position: relative;
		display: inline-flex;
	}

	.add-input {
		padding: 0.2rem 0.4rem;
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-primary);
		font-size: var(--text-xs);
		font-family: inherit;
		min-height: 24px;
		width: 70px;
		outline: none;
		border-radius: var(--radius-sm);
		transition: width 0.15s;
	}

	.has-suggestions .add-input {
		width: 120px;
	}

	.add-input:focus {
		border-color: var(--text-tertiary);
	}

	.add-input::placeholder {
		color: var(--text-tertiary);
	}

	.suggestions {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 2px;
		min-width: 100%;
		max-height: 160px;
		overflow-y: auto;
		list-style: none;
		padding: 0.2rem 0;
		background: var(--glass-bg, rgba(20, 20, 25, 0.92));
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		z-index: 50;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.suggestion-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		font-size: var(--text-xs);
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.1s;
		white-space: nowrap;
	}

	.suggestion-item:hover,
	.suggestion-item.selected {
		background: var(--bg-hover, rgba(255, 255, 255, 0.06));
		color: var(--text-primary);
	}

	.suggestion-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.suggestion-count {
		color: var(--text-tertiary);
		font-size: 0.65rem;
		flex-shrink: 0;
	}

	/* mobile adjustments */
	@media (max-width: 480px) {
		.filter-toggle {
			padding: 0.4rem;
		}

		.tag-chip {
			padding: 0.3rem 0.5rem;
			min-height: 28px;
		}

		.add-btn {
			width: 28px;
			height: 28px;
		}

		.add-input {
			min-height: 28px;
			width: 80px;
		}

		.has-suggestions .add-input {
			width: 130px;
		}
	}
</style>
