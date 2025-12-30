<script lang="ts">
	import { portal } from 'svelte-portal';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { queue } from '$lib/queue.svelte';
	import { preferences, type Theme } from '$lib/preferences.svelte';
	import type { User } from '$lib/types';

	interface Props {
		user: User | null;
		onLogout: () => Promise<void>;
	}

	let { user, onLogout }: Props = $props();
	let isOnPortal = $derived($page.url.pathname === '/portal');
	let isOnUpload = $derived($page.url.pathname === '/upload');
	let showMenu = $state(false);
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
		{ value: 'system', label: 'auto', icon: 'auto' }
	];

	let currentColor = $derived(preferences.accentColor ?? '#6a9fff');
	let autoAdvance = $derived(preferences.autoAdvance);
	let currentTheme = $derived(preferences.theme);

	$effect(() => {
		if (currentColor) {
			applyColorLocally(currentColor);
		}
	});

	$effect(() => {
		queue.setAutoAdvance(autoAdvance);
	});

	onMount(() => {
		const savedAccent = localStorage.getItem('accentColor');
		if (savedAccent) {
			applyColorLocally(savedAccent);
		}
	});

	function toggleMenu() {
		showMenu = !showMenu;
		if (!showMenu) {
			showSettings = false;
		}
	}

	function closeMenu() {
		showMenu = false;
		showSettings = false;
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

	async function handleLogout() {
		closeMenu();
		await onLogout();
	}
</script>

<div class="profile-menu">
	<button class="menu-trigger" onclick={toggleMenu} title="menu">
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
			<circle cx="12" cy="5" r="2"></circle>
			<circle cx="12" cy="12" r="2"></circle>
			<circle cx="12" cy="19" r="2"></circle>
		</svg>
	</button>

	{#if showMenu}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="menu-backdrop" use:portal={'body'} onclick={closeMenu}></div>
		<div class="menu-popover" use:portal={'body'}>
			<div class="menu-header">
				<span>{showSettings ? 'settings' : 'menu'}</span>
				<button class="close-btn" onclick={closeMenu} aria-label="close">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
				</button>
			</div>

			{#if !showSettings}
				<nav class="menu-items">
					{#if !isOnPortal}
						<a href="/portal" class="menu-item" onclick={closeMenu}>
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="3" width="7" height="7"></rect>
								<rect x="14" y="3" width="7" height="7"></rect>
								<rect x="14" y="14" width="7" height="7"></rect>
								<rect x="3" y="14" width="7" height="7"></rect>
							</svg>
							<div class="item-content">
								<span class="item-title">portal</span>
								<span class="item-subtitle">@{user?.handle}</span>
							</div>
						</a>
					{/if}

					{#if !isOnUpload}
						<a href="/upload" class="menu-item" onclick={closeMenu}>
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
								<polyline points="17 8 12 3 7 8"></polyline>
								<line x1="12" y1="3" x2="12" y2="15"></line>
							</svg>
							<div class="item-content">
								<span class="item-title">upload</span>
								<span class="item-subtitle">add a track</span>
							</div>
						</a>
					{/if}

					<button class="menu-item" onclick={() => showSettings = true}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
							<circle cx="12" cy="12" r="3"></circle>
						</svg>
						<div class="item-content">
							<span class="item-title">settings</span>
							<span class="item-subtitle">theme, colors, playback</span>
						</div>
						<svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="9 18 15 12 9 6"></polyline>
						</svg>
					</button>

					<button class="menu-item logout" onclick={handleLogout}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
							<polyline points="16 17 21 12 16 7"></polyline>
							<line x1="21" y1="12" x2="9" y2="12"></line>
						</svg>
						<div class="item-content">
							<span class="item-title">logout</span>
						</div>
					</button>
				</nav>
			{:else}
				<button class="back-btn" onclick={() => showSettings = false}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="15 18 9 12 15 6"></polyline>
					</svg>
					<span>back</span>
				</button>

				<div class="settings-content">
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
						<h3>accent</h3>
						<div class="color-row">
							<input type="color" value={currentColor} oninput={handleColorInput} class="color-input" />
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
					</section>

					<section class="settings-section">
						<h3>playback</h3>
						<label class="toggle">
							<input type="checkbox" checked={autoAdvance} oninput={handleAutoAdvanceToggle} />
							<span class="toggle-text">auto-play next</span>
						</label>
					</section>

					<a href="/settings" class="all-settings-link" onclick={closeMenu}>
						all settings →
					</a>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.profile-menu {
		position: relative;
	}

	.menu-trigger {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.menu-trigger:hover {
		background: var(--bg-tertiary);
		border-color: var(--accent);
		color: var(--accent);
	}

	.menu-trigger:active {
		transform: scale(0.96);
	}

	.menu-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 100;
		animation: fadeIn 0.12s ease-out;
	}

	.menu-popover {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(340px, calc(100vw - 2rem));
		max-height: calc(100vh - 4rem);
		overflow-y: auto;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		z-index: 101;
		animation: slideIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.menu-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--border-subtle);
	}

	.menu-header span {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: transparent;
		border: none;
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.close-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.close-btn:active {
		transform: scale(0.94);
	}

	.menu-items {
		display: flex;
		flex-direction: column;
		padding: 0.5rem;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		min-height: 56px;
		background: transparent;
		border: none;
		border-radius: var(--radius-lg);
		text-decoration: none;
		color: var(--text-primary);
		font-family: inherit;
		font-size: inherit;
		cursor: pointer;
		transition: all 0.15s;
		text-align: left;
		width: 100%;
		-webkit-tap-highlight-color: transparent;
	}

	.menu-item:hover {
		background: var(--bg-hover);
	}

	.menu-item:active {
		transform: scale(0.98);
	}

	.menu-item svg:first-child {
		flex-shrink: 0;
		color: var(--text-secondary);
		transition: color 0.15s;
	}

	.menu-item:hover svg:first-child {
		color: var(--accent);
	}

	.menu-item.logout:hover svg:first-child {
		color: var(--error);
	}

	.item-content {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		flex: 1;
		min-width: 0;
	}

	.item-title {
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-primary);
	}

	.item-subtitle {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chevron {
		flex-shrink: 0;
		color: var(--text-tertiary);
	}

	.back-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.75rem 1rem 0.5rem;
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: none;
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.back-btn:hover {
		color: var(--accent);
		background: var(--bg-hover);
	}

	.settings-content {
		padding: 0.75rem 1.25rem 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.settings-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.settings-section h3 {
		margin: 0;
		font-size: 0.75rem;
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
		padding: 0.75rem 0.5rem;
		min-height: 54px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
		-webkit-tap-highlight-color: transparent;
	}

	.theme-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.theme-btn:active {
		transform: scale(0.96);
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

	.color-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.color-input {
		width: 44px;
		height: 44px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		background: transparent;
		flex-shrink: 0;
	}

	.color-input::-webkit-color-swatch-wrapper {
		padding: 3px;
	}

	.color-input::-webkit-color-swatch {
		border-radius: var(--radius-sm);
		border: none;
	}

	.preset-grid {
		display: flex;
		gap: 0.5rem;
		flex: 1;
	}

	.preset-btn {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-base);
		border: 2px solid transparent;
		cursor: pointer;
		transition: all 0.15s;
		padding: 0;
		-webkit-tap-highlight-color: transparent;
	}

	.preset-btn:hover {
		transform: scale(1.08);
	}

	.preset-btn:active {
		transform: scale(0.96);
	}

	.preset-btn.active {
		border-color: var(--text-primary);
		box-shadow: 0 0 0 1px var(--bg-secondary);
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--text-primary);
		font-size: 0.9rem;
		cursor: pointer;
		padding: 0.5rem 0;
	}

	.toggle input {
		appearance: none;
		width: 48px;
		height: 28px;
		border-radius: var(--radius-full);
		background: var(--border-default);
		position: relative;
		cursor: pointer;
		transition: background 0.15s, border 0.15s;
		border: 1px solid var(--border-default);
		flex-shrink: 0;
	}

	.toggle input::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		background: var(--text-secondary);
		transition: transform 0.15s, background 0.15s;
	}

	.toggle input:checked {
		background: color-mix(in srgb, var(--accent) 65%, transparent);
		border-color: var(--accent);
	}

	.toggle input:checked::after {
		transform: translateX(20px);
		background: var(--accent);
	}

	.toggle-text {
		white-space: nowrap;
	}

	.all-settings-link {
		display: block;
		text-align: center;
		padding: 1rem;
		margin-top: 0.5rem;
		border-top: 1px solid var(--border-subtle);
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.9rem;
		transition: color 0.15s;
	}

	.all-settings-link:hover {
		color: var(--accent);
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translate(-50%, -48%) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}

	@media (max-width: 768px) {
		.menu-popover {
			/* stay centered but shift up to avoid player */
			top: calc(50% - var(--player-height, 0px) / 2);
			max-height: calc(100vh - var(--player-height, 0px) - 3rem - env(safe-area-inset-bottom, 0px));
		}
	}
</style>
