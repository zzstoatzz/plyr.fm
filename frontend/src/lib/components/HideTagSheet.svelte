<script lang="ts">
	import { portal } from 'svelte-portal';
	import { API_URL } from '$lib/config';

	interface TagSuggestion {
		name: string;
		track_count: number;
	}

	interface Props {
		hiddenTags: string[];
		onHide: (tag: string) => void;
		onUnhide: (tag: string) => void;
	}

	let { hiddenTags, onHide, onUnhide }: Props = $props();

	let isOpen = $state(false);
	let query = $state('');
	let matches = $state<TagSuggestion[]>([]);
	let popular = $state<TagSuggestion[]>([]);
	let selectedIndex = $state(-1);
	let viewport = $state<{ top: number; height: number } | null>(null);
	let sheetEl = $state<HTMLDivElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	let normalized = $derived(query.trim().toLowerCase());
	let rows = $derived(
		(normalized ? matches : popular).filter((t) => !hiddenTags.includes(t.name))
	);
	let offerCustom = $derived(
		normalized.length > 0 &&
			!hiddenTags.includes(normalized) &&
			!rows.some((t) => t.name === normalized)
	);
	let optionCount = $derived(rows.length + (offerCustom ? 1 : 0));

	/** open from a click handler: the input is focused synchronously so iOS shows the keyboard. */
	export function open() {
		if (sheetEl) sheetEl.inert = false;
		inputEl?.focus();
		isOpen = true;
		query = '';
		matches = [];
		selectedIndex = -1;
		if (popular.length === 0) loadPopular();
	}

	function close() {
		isOpen = false;
		inputEl?.blur();
		if (searchTimeout) clearTimeout(searchTimeout);
	}

	async function fetchTags(params: string): Promise<TagSuggestion[]> {
		try {
			const res = await fetch(`${API_URL}/tracks/tags?${params}`);
			return res.ok ? await res.json() : [];
		} catch {
			return [];
		}
	}

	async function loadPopular() {
		popular = await fetchTags('limit=20');
	}

	function handleInput() {
		selectedIndex = -1;
		if (searchTimeout) clearTimeout(searchTimeout);
		const q = normalized;
		if (!q) {
			matches = [];
			return;
		}
		searchTimeout = setTimeout(async () => {
			const found = await fetchTags(`q=${encodeURIComponent(q)}&limit=12`);
			if (normalized === q) matches = found;
		}, 150);
	}

	function hide(tag: string) {
		onHide(tag);
		query = '';
		matches = [];
		selectedIndex = -1;
		inputEl?.focus();
	}

	function choose(index: number) {
		if (index < rows.length) hide(rows[index].name);
		else if (offerCustom) hide(normalized);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		} else if (e.key === 'ArrowDown' && optionCount > 0) {
			e.preventDefault();
			selectedIndex = (selectedIndex + 1) % optionCount;
		} else if (e.key === 'ArrowUp' && optionCount > 0) {
			e.preventDefault();
			selectedIndex = selectedIndex <= 0 ? optionCount - 1 : selectedIndex - 1;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (selectedIndex >= 0) choose(selectedIndex);
			else if (offerCustom) hide(normalized);
			else if (rows.length > 0 && normalized) choose(0);
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) close();
	}

	$effect(() => {
		if (sheetEl) sheetEl.inert = !isOpen;
	});

	$effect(() => {
		const vv = window.visualViewport;
		if (!isOpen || !vv) {
			viewport = null;
			return;
		}
		const sync = () => (viewport = { top: vv.offsetTop, height: vv.height });
		sync();
		vv.addEventListener('resize', sync);
		vv.addEventListener('scroll', sync);
		return () => {
			vv.removeEventListener('resize', sync);
			vv.removeEventListener('scroll', sync);
		};
	});
</script>

<!-- always rendered so open() can focus the input inside the tap (iOS keyboard) -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	bind:this={sheetEl}
	use:portal={'body'}
	class="sheet-backdrop"
	class:open={isOpen}
	style={viewport ? `top: ${viewport.top}px; height: ${viewport.height}px; bottom: auto;` : undefined}
	role="presentation"
	onclick={handleBackdropClick}
>
	<div class="sheet" role="dialog" aria-modal="true" aria-label="hide a tag">
		<div class="input-row">
			<svg class="eye-off" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.5" opacity="0.5" />
				<circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="1.5" opacity="0.5" />
				<line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
			<input
				bind:this={inputEl}
				bind:value={query}
				oninput={handleInput}
				onkeydown={handleKeydown}
				type="text"
				class="tag-input"
				placeholder="hide a tag…"
				maxlength="50"
				enterkeyhint="done"
				autocomplete="off"
				autocorrect="off"
				autocapitalize="off"
				spellcheck="false"
				role="combobox"
				aria-expanded={optionCount > 0}
				aria-controls="hide-tag-options"
			/>
			<button type="button" class="done" onclick={close}>done</button>
		</div>

		{#if hiddenTags.length > 0}
			<div class="hidden-row">
				{#each hiddenTags as tag (tag)}
					<button type="button" class="hidden-chip" onclick={() => onUnhide(tag)} aria-label="unhide {tag}">
						{tag}<span class="chip-x" aria-hidden="true">×</span>
					</button>
				{/each}
			</div>
		{/if}

		<div class="options">
			{#if optionCount > 0}
				{#if !normalized}
					<p class="section-label">popular tags</p>
				{/if}
				<ul id="hide-tag-options" role="listbox" aria-label="tags to hide">
					{#each rows as tag, i (tag.name)}
						<li role="option" aria-selected={i === selectedIndex}>
							<button
								type="button"
								class="option"
								class:selected={i === selectedIndex}
								onclick={() => choose(i)}
							>
								<span class="option-name">{tag.name}</span>
								<span class="option-count">{tag.track_count} {tag.track_count === 1 ? 'track' : 'tracks'}</span>
							</button>
						</li>
					{/each}
					{#if offerCustom}
						<li role="option" aria-selected={selectedIndex === rows.length}>
							<button
								type="button"
								class="option"
								class:selected={selectedIndex === rows.length}
								onclick={() => hide(normalized)}
							>
								<span class="option-name">hide “{normalized}”</span>
							</button>
						</li>
					{/if}
				</ul>
			{:else if normalized}
				<p class="empty">“{normalized}” is already hidden</p>
			{:else}
				<p class="empty">type a tag to hide it from your feeds</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.sheet-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: max(12vh, 1rem) 1rem 1rem;
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s;
	}

	.sheet-backdrop.open {
		opacity: 1;
		pointer-events: auto;
	}

	.sheet {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 480px;
		max-height: min(560px, 100%);
		background: var(--glass-bg, color-mix(in srgb, var(--bg-secondary) 95%, transparent));
		backdrop-filter: blur(24px) saturate(180%);
		-webkit-backdrop-filter: blur(24px) saturate(180%);
		border: 1px solid var(--glass-border, var(--border-subtle));
		border-radius: var(--radius-xl);
		box-shadow:
			0 24px 80px color-mix(in srgb, var(--bg-primary) 50%, transparent),
			0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent);
		overflow: hidden;
		transform: translateY(-6px) scale(0.98);
		transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.open .sheet {
		transform: none;
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.75rem 0.75rem 1rem;
		border-bottom: 1px solid var(--border-subtle);
	}

	.eye-off {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: var(--text-tertiary);
	}

	.tag-input {
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0;
		background: transparent;
		border: none;
		border-radius: 0;
		outline: none;
		appearance: none;
		color: var(--text-primary);
		font-family: inherit;
		font-size: 16px; /* prevents zoom on iOS */
	}

	.tag-input::placeholder {
		color: var(--text-tertiary);
	}

	.done {
		flex-shrink: 0;
		min-height: 36px;
		padding: 0 0.75rem;
		background: transparent;
		border: none;
		border-radius: var(--radius-base);
		color: var(--accent);
		font-family: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}

	.done:hover {
		background: var(--bg-hover);
	}

	.hidden-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border-subtle);
	}

	.hidden-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 32px;
		padding: 0 0.6rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.hidden-chip:hover {
		border-color: color-mix(in srgb, var(--error) 50%, transparent);
		color: var(--error);
	}

	.chip-x {
		opacity: 0.6;
	}

	.options {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.4rem;
	}

	.options ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.section-label {
		margin: 0.4rem 0.6rem 0.3rem;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
		min-height: 44px;
		padding: 0 0.6rem;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-base);
		text-align: left;
		cursor: pointer;
	}

	.option:hover,
	.option.selected {
		background: var(--bg-hover);
	}

	.option-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.option-count {
		flex-shrink: 0;
		color: var(--text-tertiary);
		font-size: var(--text-xs);
	}

	.empty {
		margin: 0;
		padding: 1rem 0.6rem;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
	}

	@media (max-width: 768px) {
		.sheet-backdrop {
			padding: calc(env(safe-area-inset-top, 0px) + 0.5rem) 0.5rem 0.5rem;
		}

		.sheet {
			max-height: 100%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet-backdrop,
		.sheet {
			transition: none;
		}
	}
</style>
