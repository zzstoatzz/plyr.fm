<script lang="ts">
	import { onMount } from 'svelte';
	import { queue } from '$lib/queue.svelte';
	import { preferences, type Theme } from '$lib/preferences.svelte';

	let showSettings = $state(false);

	const presetColors = [
		{ name: 'blue', value: '#6a9fff' },
		{ name: 'purple', value: '#a78bfa' },
		{ name: 'pink', value: '#f472b6' },
		{ name: 'green', value: '#4ade80' },
		{ name: 'orange', value: '#fb923c' },
		{ name: 'red', value: '#ef4444' }
	];

	const themes: { value: Theme; label: string; icon: string }[] = [
		{ value: 'dark', label: 'dark', icon: 'moon' },
		{ value: 'light', label: 'light', icon: 'sun' },
		{ value: 'system', label: 'system', icon: 'auto' }
	];

	// derive from preferences store
	let currentColor = $derived(preferences.accentColor ?? '#6a9fff');
	let autoAdvance = $derived(preferences.autoAdvance);
	let currentTheme = $derived(preferences.theme);

	// apply color when it changes
	$effect(() => {
		if (currentColor) {
			applyColorLocally(currentColor);
		}
	});

	// sync auto-advance with queue
	$effect(() => {
		queue.setAutoAdvance(autoAdvance);
	});

	onMount(() => {
		// apply initial color from localStorage while waiting for preferences
		const savedAccent = localStorage.getItem('accentColor');
		if (savedAccent) {
			applyColorLocally(savedAccent);
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

	async function applyColor(color: string) {
		applyColorLocally(color);
		localStorage.setItem('accentColor', color);
		await preferences.update({ accent_color: color });
	}

	function handleColorInput(event: Event) {
		const input = event.target as HTMLInputElement;
		applyColor(input.value);
	}

	function selectPreset(color: string) {
		applyColor(color);
	}

	async function handleAutoAdvanceToggle(event: Event) {
		const input = event.target as HTMLInputElement;
		const value = input.checked;
		queue.setAutoAdvance(value);
		localStorage.setItem('autoAdvance', value ? '1' : '0');
		await preferences.update({ auto_advance: value });
	}

	function selectTheme(theme: Theme) {
		preferences.setTheme(theme);
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
				<h3>theme</h3>
				<div class="theme-buttons">
					{#each themes as theme}
						<button
							class="theme-btn"
							class:active={currentTheme === theme.value}
							onclick={() => selectTheme(theme.value)}
							title={theme.label}
						>
							{#if theme.icon === 'moon'}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
								</svg>
							{:else if theme.icon === 'sun'}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<circle cx="12" cy="12" r="5" />
									<path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
								</svg>
							{:else}
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<circle cx="12" cy="12" r="9" />
									<path d="M12 3v18" />
									<path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" opacity="0.3" />
								</svg>
							{/if}
							<span>{theme.label}</span>
						</button>
					{/each}
				</div>
			</section>

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
		min-width: 280px;
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

	.theme-buttons {
		display: flex;
		gap: 0.5rem;
	}

	.theme-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0.6rem 0.5rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s;
	}

	.theme-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.theme-btn.active {
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		border-color: var(--accent);
		color: var(--accent);
	}

	.theme-btn svg {
		width: 18px;
		height: 18px;
	}

	.theme-btn span {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
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
		flex-shrink: 0;
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

	@media (max-width: 768px) {
		.settings-panel {
			position: fixed;
			top: auto;
			bottom: calc(var(--player-height, 0px) + 1rem);
			right: 1rem;
			left: 1rem;
			min-width: auto;
			max-height: 70vh;
			overflow-y: auto;
		}
	}
</style>
