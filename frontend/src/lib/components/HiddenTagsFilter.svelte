<script lang="ts">
	import { tracksCache } from '$lib/tracks.svelte';
	import { auth } from '$lib/auth.svelte';
	import { preferences } from '$lib/preferences.svelte';

	let isExpanded = $state(false);
	let addingTag = $state(false);
	let newTag = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	// derive hidden tags from preferences store
	let hiddenTags = $derived(preferences.data?.hidden_tags ?? []);

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

		if (normalized && !hiddenTags.includes(normalized)) {
			const updated = [...hiddenTags, normalized];
			await preferences.update({ hidden_tags: updated });
			tracksCache.invalidate();
			tracksCache.fetch(true);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addTag(newTag);
		} else if (e.key === 'Escape') {
			addingTag = false;
			newTag = '';
		}
	}

	function toggleExpanded() {
		isExpanded = !isExpanded;
		if (!isExpanded) {
			addingTag = false;
			newTag = '';
		}
	}

	function startAddingTag() {
		addingTag = true;
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
				<span class="filter-label">hiding:</span>
				{#each hiddenTags as tag}
					<button type="button" class="tag-chip" onclick={() => removeTag(tag)} title="unhide '{tag}'">
						{tag}
						<span class="remove-icon">×</span>
					</button>
				{/each}

				{#if addingTag}
					<input
						bind:this={inputEl}
						type="text"
						bind:value={newTag}
						onkeydown={handleKeydown}
						onblur={() => {
							if (!newTag.trim()) addingTag = false;
						}}
						placeholder="tag"
						class="add-input"
					/>
				{:else}
					<button type="button" class="add-btn" onclick={startAddingTag}>
						+
					</button>
				{/if}

				{#if hiddenTags.length === 0 && !addingTag}
					<span class="empty-hint">none</span>
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
		font-size: 0.8rem;
	}

	.filter-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem;
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: color 0.15s;
		border-radius: 4px;
	}

	.filter-toggle:hover {
		color: var(--text-secondary);
	}

	.filter-toggle.has-filters {
		color: var(--text-secondary);
	}

	.eye-icon {
		width: 18px;
		height: 18px;
	}

	.filter-count {
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}

	.filter-label {
		color: var(--text-tertiary);
		white-space: nowrap;
		font-size: 0.75rem;
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
		border-radius: 3px;
		font-size: 0.75rem;
		font-family: inherit;
		cursor: pointer;
		transition: all 0.15s;
		min-height: 24px;
	}

	.tag-chip:hover {
		border-color: rgba(255, 107, 107, 0.5);
		color: #ff6b6b;
	}

	.tag-chip:active {
		transform: scale(0.97);
	}

	.remove-icon {
		font-size: 0.8rem;
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
		border-radius: 3px;
		color: var(--text-tertiary);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.add-btn:hover {
		border-color: var(--text-tertiary);
		color: var(--text-secondary);
	}

	.add-input {
		padding: 0.2rem 0.4rem;
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-primary);
		font-size: 0.75rem;
		font-family: inherit;
		min-height: 24px;
		width: 70px;
		outline: none;
		border-radius: 3px;
	}

	.add-input:focus {
		border-color: var(--text-tertiary);
	}

	.add-input::placeholder {
		color: var(--text-tertiary);
	}

	.empty-hint {
		color: var(--text-tertiary);
		font-size: 0.7rem;
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
	}
</style>
