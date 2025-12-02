<script lang="ts">
	import { API_URL } from '$lib/config';

	interface TagSuggestion {
		name: string;
		track_count: number;
	}

	interface Props {
		tags: string[];
		onAdd: (_tag: string) => void;
		onRemove: (_tag: string) => void;
		placeholder?: string;
		disabled?: boolean;
	}

	let { tags = $bindable([]), onAdd, onRemove, placeholder = 'add tag...', disabled = false }: Props = $props();

	let inputValue = $state('');
	let suggestions = $state<TagSuggestion[]>([]);
	let showSuggestions = $state(false);
	let searching = $state(false);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	let selectedIndex = $state(-1);

	async function searchTags() {
		if (inputValue.length < 1) {
			suggestions = [];
			return;
		}

		searching = true;
		try {
			const response = await fetch(`${API_URL}/tracks/tags?q=${encodeURIComponent(inputValue)}&limit=10`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data: TagSuggestion[] = await response.json();
				// filter out tags already added
				suggestions = data.filter(s => !tags.includes(s.name));
				showSuggestions = suggestions.length > 0;
			}
		} catch (e) {
			console.error('tag search failed:', e);
		} finally {
			searching = false;
		}
	}

	function handleInput() {
		selectedIndex = -1;
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(searchTags, 200);
	}

	function addTag(tag: string) {
		const normalized = tag.trim().toLowerCase();
		if (normalized && !tags.includes(normalized)) {
			onAdd(normalized);
		}
		inputValue = '';
		suggestions = [];
		showSuggestions = false;
		selectedIndex = -1;
	}

	function selectSuggestion(suggestion: TagSuggestion) {
		addTag(suggestion.name);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
				selectSuggestion(suggestions[selectedIndex]);
			} else if (inputValue.trim()) {
				addTag(inputValue);
			}
		} else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
			onRemove(tags[tags.length - 1]);
		} else if (e.key === 'Escape') {
			showSuggestions = false;
			selectedIndex = -1;
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (showSuggestions && suggestions.length > 0) {
				selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (showSuggestions && suggestions.length > 0) {
				selectedIndex = Math.max(selectedIndex - 1, -1);
			}
		}
	}

	function handleBlur() {
		// delay to allow click on suggestion
		setTimeout(() => {
			if (inputValue.trim()) {
				addTag(inputValue);
			}
			showSuggestions = false;
			selectedIndex = -1;
		}, 150);
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.tag-input-wrapper')) {
			showSuggestions = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="tag-input-wrapper">
	<div class="tags-container">
		{#each tags as tag}
			<span class="tag-chip">
				{tag}
				<button
					type="button"
					class="tag-remove"
					onclick={() => onRemove(tag)}
					{disabled}
				>×</button>
			</span>
		{/each}
		<input
			type="text"
			bind:value={inputValue}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onblur={handleBlur}
			onfocus={() => { if (suggestions.length > 0) showSuggestions = true; }}
			placeholder={tags.length === 0 ? placeholder : ''}
			class="tag-input"
			{disabled}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
		/>
		{#if searching}
			<span class="spinner">...</span>
		{/if}
	</div>

	{#if showSuggestions && suggestions.length > 0}
		<div class="suggestions">
			{#each suggestions as suggestion, i}
				<button
					type="button"
					class="suggestion-item"
					class:selected={i === selectedIndex}
					onclick={() => selectSuggestion(suggestion)}
				>
					<span class="tag-name">{suggestion.name}</span>
					<span class="tag-count">{suggestion.track_count} {suggestion.track_count === 1 ? 'track' : 'tracks'}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.tag-input-wrapper {
		position: relative;
		width: 100%;
	}

	.tags-container {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		min-height: 48px;
		transition: all 0.2s;
	}

	.tags-container:focus-within {
		border-color: #3a7dff;
	}

	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.6rem;
		background: #1a2330;
		border: 1px solid #2a3a4a;
		color: #8ab3ff;
		border-radius: 20px;
		font-size: 0.9rem;
		font-weight: 500;
	}

	.tag-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		background: none;
		border: none;
		color: #888;
		cursor: pointer;
		font-size: 1.2rem;
		font-family: inherit;
		line-height: 1;
		transition: color 0.2s;
	}

	.tag-remove:hover {
		color: #ff6b6b;
	}

	.tag-remove:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.tag-input {
		flex: 1;
		min-width: 120px;
		padding: 0;
		background: transparent;
		border: none;
		color: white;
		font-size: 1rem;
		font-family: inherit;
		outline: none;
	}

	.tag-input::placeholder {
		color: #666;
	}

	.tag-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner {
		color: #666;
		font-size: 0.85rem;
		margin-left: auto;
	}

	.suggestions {
		position: absolute;
		z-index: 100;
		width: 100%;
		max-height: 200px;
		overflow-y: auto;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 4px;
		margin-top: 0.25rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
		scrollbar-width: thin;
		scrollbar-color: #333 #0a0a0a;
	}

	.suggestions::-webkit-scrollbar {
		width: 8px;
	}

	.suggestions::-webkit-scrollbar-track {
		background: #0a0a0a;
		border-radius: 4px;
	}

	.suggestions::-webkit-scrollbar-thumb {
		background: #333;
		border-radius: 4px;
	}

	.suggestions::-webkit-scrollbar-thumb:hover {
		background: #444;
	}

	.suggestion-item {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid #2a2a2a;
		color: white;
		text-align: left;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	.suggestion-item:last-child {
		border-bottom: none;
	}

	.suggestion-item:hover,
	.suggestion-item.selected {
		background: #222;
	}

	.tag-name {
		font-weight: 500;
		color: #e8e8e8;
	}

	.tag-count {
		font-size: 0.85rem;
		color: #888;
	}

	@media (max-width: 768px) {
		.tag-input {
			font-size: 16px; /* prevents zoom on iOS */
		}

		.suggestions {
			max-height: 160px;
		}

		.tag-chip {
			padding: 0.3rem 0.5rem;
			font-size: 0.85rem;
		}
	}
</style>
