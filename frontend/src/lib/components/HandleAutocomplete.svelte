<script lang="ts">
	import { API_URL } from '$lib/config';

	interface HandleResult {
		did: string;
		handle: string;
		display_name: string;
		avatar_url: string | null;
	}

	interface Props {
		value: string;
		onSelect: (_handle: string) => void;
		placeholder?: string;
		disabled?: boolean;
	}

	let { value = $bindable(''), onSelect, placeholder = 'search by handle...', disabled = false }: Props = $props();

	let results = $state<HandleResult[]>([]);
	let searching = $state(false);
	let showResults = $state(false);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	async function searchHandles() {
		if (value.length < 2) {
			results = [];
			return;
		}

		searching = true;
		try {
			const response = await fetch(`${API_URL}/search/handles?q=${encodeURIComponent(value)}`);
			if (response.ok) {
				const data = await response.json();
				results = data.results;
				showResults = results.length > 0;
			}
		} catch (e) {
			console.error('search failed:', e);
		} finally {
			searching = false;
		}
	}

	function handleInput() {
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(searchHandles, 300);
	}

	function selectHandle(result: HandleResult) {
		value = result.handle;
		onSelect(result.handle);
		results = [];
		showResults = false;
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.handle-autocomplete')) {
			showResults = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			showResults = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="handle-autocomplete">
	<div class="input-wrapper">
		<input
			type="text"
			bind:value
			oninput={handleInput}
			onkeydown={handleKeydown}
			onfocus={() => { if (results.length > 0) showResults = true; }}
			{placeholder}
			{disabled}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
		/>
		{#if searching}
			<span class="spinner">...</span>
		{/if}
	</div>

	{#if showResults && results.length > 0}
		<div class="results">
			{#each results as result}
				<button
					type="button"
					class="result-item"
					onclick={() => selectHandle(result)}
				>
					{#if result.avatar_url}
						<img src={result.avatar_url} alt="" class="avatar" />
					{:else}
						<div class="avatar-placeholder"></div>
					{/if}
					<div class="info">
						<div class="display-name">{result.display_name}</div>
						<div class="handle">@{result.handle}</div>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.handle-autocomplete {
		position: relative;
		width: 100%;
	}

	.input-wrapper {
		position: relative;
	}

	.input-wrapper input {
		width: 100%;
		padding: 0.75rem;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		color: white;
		font-size: 1rem;
		font-family: inherit;
		transition: border-color 0.2s;
		box-sizing: border-box;
	}

	.input-wrapper input:focus {
		outline: none;
		border-color: var(--accent, #3a7dff);
	}

	.input-wrapper input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.input-wrapper input::placeholder {
		color: #666;
	}

	.spinner {
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		color: #666;
		font-size: 0.85rem;
	}

	.results {
		position: absolute;
		z-index: 100;
		width: 100%;
		max-height: 240px;
		overflow-y: auto;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 4px;
		margin-top: 0.25rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
		scrollbar-width: thin;
		scrollbar-color: #333 #0a0a0a;
	}

	.results::-webkit-scrollbar {
		width: 8px;
	}

	.results::-webkit-scrollbar-track {
		background: #0a0a0a;
		border-radius: 4px;
	}

	.results::-webkit-scrollbar-thumb {
		background: #333;
		border-radius: 4px;
	}

	.results::-webkit-scrollbar-thumb:hover {
		background: #444;
	}

	.result-item {
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
		transition: background 0.15s;
	}

	.result-item:last-child {
		border-bottom: none;
	}

	.result-item:hover {
		background: #222;
	}

	.avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid #333;
		flex-shrink: 0;
	}

	.avatar-placeholder {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: #333;
		flex-shrink: 0;
	}

	.info {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.display-name {
		font-weight: 500;
		color: #e8e8e8;
		margin-bottom: 0.125rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.handle {
		font-size: 0.85rem;
		color: #888;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (max-width: 768px) {
		.input-wrapper input {
			font-size: 16px; /* prevents zoom on iOS */
		}

		.results {
			max-height: 200px;
		}

		.avatar {
			width: 32px;
			height: 32px;
		}

		.avatar-placeholder {
			width: 32px;
			height: 32px;
		}
	}
</style>
