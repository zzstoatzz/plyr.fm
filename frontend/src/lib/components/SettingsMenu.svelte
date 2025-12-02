<script lang="ts">
	import { onMount } from 'svelte';
	import { API_URL } from '$lib/config';
	import { queue } from '$lib/queue.svelte';
	import { tracksCache } from '$lib/tracks.svelte';

	let showSettings = $state(false);
	let currentColor = $state('#6a9fff');
	let autoAdvance = $state(true);
	let hiddenTags = $state<string[]>(['ai']);
	let newHiddenTag = $state('');

	const presetColors = [
		{ name: 'blue', value: '#6a9fff' },
		{ name: 'purple', value: '#a78bfa' },
		{ name: 'pink', value: '#f472b6' },
		{ name: 'green', value: '#4ade80' },
		{ name: 'orange', value: '#fb923c' },
		{ name: 'red', value: '#ef4444' }
	];

	onMount(async () => {
		const savedAccent = localStorage.getItem('accentColor');
		if (savedAccent) {
			currentColor = savedAccent;
			applyColorLocally(savedAccent);
		}

		const savedAutoAdvance = localStorage.getItem('autoAdvance');
		autoAdvance = savedAutoAdvance === null ? true : savedAutoAdvance !== '0';
		queue.setAutoAdvance(autoAdvance);

		try {
			const response = await fetch(`${API_URL}/preferences/`, {
				credentials: 'include'
			});

			if (!response.ok) return;

			const data = await response.json();
			if (data.accent_color) {
				currentColor = data.accent_color;
				applyColorLocally(data.accent_color);
				localStorage.setItem('accentColor', data.accent_color);
			}

			autoAdvance = data.auto_advance ?? true;
			queue.setAutoAdvance(autoAdvance);
			localStorage.setItem('autoAdvance', autoAdvance ? '1' : '0');

			if (data.hidden_tags) {
				hiddenTags = data.hidden_tags;
			}
		} catch (error) {
			console.error('failed to fetch preferences:', error);
		}
	});

	function toggleSettings() {
		showSettings = !showSettings;
	}

	function applyColorLocally(color: string) {
		document.documentElement.style.setProperty('--accent', color);

		const r = parseInt(color.slice(1, 3), 16);
		const g = parseInt(color.slice(3, 5), 16);
		const b = parseInt(color.slice(5, 7), 16);
		const hover = `rgb(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)})`;
		document.documentElement.style.setProperty('--accent-hover', hover);
	}

	async function savePreferences(update: Record<string, unknown>) {
		try {
			await fetch(`${API_URL}/preferences/`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify(update)
			});
		} catch (error) {
			console.error('failed to save preferences:', error);
		}
	}

	function applyColor(color: string) {
		currentColor = color;
		applyColorLocally(color);
		localStorage.setItem('accentColor', color);
		savePreferences({ accent_color: color });
	}

	function handleColorInput(event: Event) {
		const input = event.target as HTMLInputElement;
		applyColor(input.value);
	}

	function selectPreset(color: string) {
		applyColor(color);
	}

	function handleAutoAdvanceToggle(event: Event) {
		const input = event.target as HTMLInputElement;
		autoAdvance = input.checked;
		queue.setAutoAdvance(autoAdvance);
		localStorage.setItem('autoAdvance', autoAdvance ? '1' : '0');
		savePreferences({ auto_advance: autoAdvance });
	}

	async function addHiddenTag(tag: string) {
		const normalized = tag.trim().toLowerCase();
		if (normalized && !hiddenTags.includes(normalized)) {
			hiddenTags = [...hiddenTags, normalized];
			await savePreferences({ hidden_tags: hiddenTags });
			tracksCache.invalidate();
			tracksCache.fetch(true);
		}
		newHiddenTag = '';
	}

	async function removeHiddenTag(tag: string) {
		hiddenTags = hiddenTags.filter((t) => t !== tag);
		await savePreferences({ hidden_tags: hiddenTags });
		tracksCache.invalidate();
		tracksCache.fetch(true);
	}

	function handleHiddenTagKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addHiddenTag(newHiddenTag);
		}
	}
</script>

<div class="settings-menu">
	<button class="settings-toggle" onclick={toggleSettings} title="settings">
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
			<circle cx="12" cy="12" r="3"></circle>
		</svg>
	</button>

	{#if showSettings}
		<div class="settings-panel">
			<div class="panel-header">
				<span>settings</span>
				<button class="close-btn" onclick={toggleSettings}>×</button>
			</div>

			<section class="settings-section">
				<h3>accent color</h3>
				<div class="color-picker-row">
					<input type="color" value={currentColor} oninput={handleColorInput} class="color-input" />
					<span class="color-value">{currentColor}</span>
				</div>

				<div class="preset-grid">
					{#each presetColors as preset}
						<button
							class="preset-btn"
							class:active={currentColor.toLowerCase() === preset.value.toLowerCase()}
							style="background: {preset.value}"
							onclick={() => selectPreset(preset.value)}
							title={preset.name}
						></button>
					{/each}
				</div>
			</section>

			<section class="settings-section">
				<h3>playback</h3>
				<label class="toggle">
					<input type="checkbox" checked={autoAdvance} oninput={handleAutoAdvanceToggle} />
					<span class="toggle-indicator"></span>
					<span class="toggle-text">auto-play next track</span>
				</label>
				<p class="toggle-hint">when a track ends, start the next item in your queue</p>
			</section>

			<section class="settings-section">
				<h3>hidden tags</h3>
				<p class="toggle-hint">tracks with these tags won't appear in latest tracks</p>
				<div class="hidden-tags-container">
					{#each hiddenTags as tag}
						<span class="hidden-tag-chip">
							{tag}
							<button
								type="button"
								class="hidden-tag-remove"
								onclick={() => removeHiddenTag(tag)}
								title="remove {tag}"
							>×</button>
						</span>
					{/each}
					<input
						type="text"
						bind:value={newHiddenTag}
						onkeydown={handleHiddenTagKeydown}
						placeholder={hiddenTags.length === 0 ? 'add tag...' : ''}
						class="hidden-tag-input"
					/>
				</div>
			</section>
		</div>
	{/if}
</div>

<style>
	.settings-menu {
		position: relative;
	}

	.settings-toggle {
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		padding: 0.5rem;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.settings-toggle:hover {
		color: var(--accent);
		border-color: var(--accent);
	}

	.settings-panel {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		padding: 1.25rem;
		min-width: 260px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
		z-index: 1000;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		color: var(--text-primary);
		font-weight: 600;
		font-size: 0.95rem;
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: 1.4rem;
		cursor: pointer;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.2s;
	}

	.close-btn:hover {
		color: var(--text-primary);
	}

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.settings-section h3 {
		margin: 0;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
	}

	.color-picker-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.color-input {
		width: 48px;
		height: 32px;
		border: 1px solid var(--border-default);
		border-radius: 4px;
		cursor: pointer;
		background: transparent;
	}

	.color-input::-webkit-color-swatch-wrapper {
		padding: 2px;
	}

	.color-input::-webkit-color-swatch {
		border-radius: 2px;
		border: none;
	}

	.color-value {
		font-family: monospace;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.preset-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.5rem;
	}

	.preset-btn {
		width: 32px;
		height: 32px;
		border-radius: 4px;
		border: 2px solid transparent;
		cursor: pointer;
		transition: all 0.2s;
		padding: 0;
	}

	.preset-btn:hover {
		transform: scale(1.08);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.preset-btn.active {
		border-color: var(--text-primary);
		box-shadow: 0 0 0 1px var(--bg-secondary), 0 2px 8px rgba(0, 0, 0, 0.35);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		color: var(--text-primary);
		font-size: 0.9rem;
	}

	.toggle input {
		appearance: none;
		width: 42px;
		height: 22px;
		border-radius: 999px;
		background: var(--border-default);
		position: relative;
		cursor: pointer;
		transition: background 0.2s, border 0.2s;
		border: 1px solid var(--border-default);
	}

	.toggle input::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--text-secondary);
		transition: transform 0.2s, background 0.2s;
	}

	.toggle input:checked {
		background: color-mix(in srgb, var(--accent) 65%, transparent);
		border-color: var(--accent);
	}

	.toggle input:checked::after {
		transform: translateX(20px);
		background: var(--accent);
	}

	.toggle-indicator {
		display: none;
	}

	.toggle-text {
		white-space: nowrap;
	}

	.toggle-hint {
		margin: 0;
		color: var(--text-tertiary);
		font-size: 0.8rem;
		line-height: 1.3;
	}

	.hidden-tags-container {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		min-height: 36px;
	}

	.hidden-tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		background: #1a2330;
		border: 1px solid #2a3a4a;
		color: #8ab3ff;
		border-radius: 20px;
		font-size: 0.8rem;
		font-weight: 500;
	}

	.hidden-tag-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		padding: 0;
		background: none;
		border: none;
		color: #888;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		transition: color 0.2s;
	}

	.hidden-tag-remove:hover {
		color: #ff6b6b;
	}

	.hidden-tag-input {
		flex: 1;
		min-width: 60px;
		padding: 0;
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-size: 0.85rem;
		font-family: inherit;
		outline: none;
	}

	.hidden-tag-input::placeholder {
		color: var(--text-tertiary);
	}
</style>
