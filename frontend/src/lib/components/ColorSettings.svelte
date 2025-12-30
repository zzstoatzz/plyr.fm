<script lang="ts">
	import { onMount } from 'svelte';
	import { preferences } from '$lib/preferences.svelte';

	let showSettings = $state(false);

	const presetColors = [
		{ name: 'blue', value: '#6a9fff' },
		{ name: 'purple', value: '#a78bfa' },
		{ name: 'pink', value: '#f472b6' },
		{ name: 'green', value: '#4ade80' },
		{ name: 'orange', value: '#fb923c' },
		{ name: 'red', value: '#ef4444' }
	];

	// derive from preferences store
	let currentColor = $derived(preferences.accentColor ?? '#6a9fff');

	// apply color when it changes
	$effect(() => {
		if (currentColor) {
			applyColorLocally(currentColor);
		}
	});

	onMount(() => {
		// apply initial color from localStorage while waiting for preferences
		const saved = localStorage.getItem('accentColor');
		if (saved) {
			applyColorLocally(saved);
		}
	});

	function applyColorLocally(color: string) {
		document.documentElement.style.setProperty('--accent', color);

		// calculate hover color
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

	function handleColorInput(e: Event) {
		const input = e.target as HTMLInputElement;
		applyColor(input.value);
	}

	function selectPreset(color: string) {
		applyColor(color);
	}

	function toggleSettings() {
		showSettings = !showSettings;
	}
</script>

<div class="color-settings">
	<button class="settings-toggle" onclick={toggleSettings} title="customize accent color">
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
			<circle cx="12" cy="12" r="3"></circle>
		</svg>
	</button>

	{#if showSettings}
		<div class="settings-panel">
			<div class="panel-header">
				<span>accent color</span>
				<button class="close-btn" onclick={toggleSettings}>×</button>
			</div>

			<div class="color-picker-row">
				<input
					type="color"
					value={currentColor}
					oninput={handleColorInput}
					class="color-input"
				/>
				<span class="color-value">{currentColor}</span>
			</div>

			<div class="presets">
				<span class="presets-label">presets</span>
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
			</div>
		</div>
	{/if}
</div>

<style>
	.color-settings {
		position: relative;
	}

	.settings-toggle {
		background: transparent;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		padding: 0.5rem;
		border-radius: var(--radius-sm);
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
		border-radius: var(--radius-base);
		padding: 1rem;
		min-width: 240px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
		z-index: 1000;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		color: var(--text-primary);
		font-size: var(--text-base);
	}

	.close-btn {
		background: transparent;
		border: none;
		color: var(--text-secondary);
		font-size: var(--text-3xl);
		cursor: pointer;
		padding: 0;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.2s;
	}

	.close-btn:hover {
		color: var(--text-primary);
	}

	.color-picker-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--border-subtle);
	}

	.color-input {
		width: 48px;
		height: 32px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		cursor: pointer;
		background: transparent;
	}

	.color-input::-webkit-color-swatch-wrapper {
		padding: 2px;
	}

	.color-input::-webkit-color-swatch {
		border: none;
		border-radius: 2px;
	}

	.color-value {
		font-family: monospace;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.presets {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.presets-label {
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.preset-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.5rem;
	}

	.preset-btn {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		border: 2px solid transparent;
		cursor: pointer;
		transition: all 0.2s;
		padding: 0;
	}

	.preset-btn:hover {
		transform: scale(1.1);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.preset-btn.active {
		border-color: var(--text-primary);
		box-shadow: 0 0 0 1px var(--bg-secondary), 0 2px 8px rgba(0, 0, 0, 0.3);
	}
</style>
