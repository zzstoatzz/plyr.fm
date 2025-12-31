<script lang="ts">
	import type { User } from '$lib/types';

	interface Props {
		user: User | null;
		onLogout: () => Promise<void>;
	}

	let { user, onLogout }: Props = $props();
	let showMenu = $state(false);
	let menuRef = $state<HTMLDivElement | null>(null);

	function toggleMenu() {
		showMenu = !showMenu;
	}

	function closeMenu() {
		showMenu = false;
	}

	async function handleLogout() {
		closeMenu();
		await onLogout();
	}

	function handleClickOutside(event: MouseEvent) {
		if (menuRef && !menuRef.contains(event.target as Node)) {
			closeMenu();
		}
	}

	$effect(() => {
		if (showMenu) {
			document.addEventListener('click', handleClickOutside);
			return () => document.removeEventListener('click', handleClickOutside);
		}
	});
</script>

<div class="user-menu" bind:this={menuRef}>
	<button class="menu-trigger" onclick={toggleMenu} title="account menu">
		<span class="handle">@{user?.handle}</span>
		<svg
			class="chevron"
			class:open={showMenu}
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<polyline points="6 9 12 15 18 9"></polyline>
		</svg>
	</button>

	{#if showMenu}
		<div class="dropdown">
			<a href="/portal" class="dropdown-item" onclick={closeMenu}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<rect x="3" y="3" width="7" height="7"></rect>
					<rect x="14" y="3" width="7" height="7"></rect>
					<rect x="14" y="14" width="7" height="7"></rect>
					<rect x="3" y="14" width="7" height="7"></rect>
				</svg>
				<span>portal</span>
			</a>
			<a href="/settings" class="dropdown-item" onclick={closeMenu}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
					<circle cx="12" cy="12" r="3"></circle>
				</svg>
				<span>settings</span>
			</a>
			<div class="dropdown-divider"></div>
			<button class="dropdown-item logout" onclick={handleLogout}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
					<polyline points="16 17 21 12 16 7"></polyline>
					<line x1="21" y1="12" x2="9" y2="12"></line>
				</svg>
				<span>logout</span>
			</button>
		</div>
	{/if}
</div>

<style>
	.user-menu {
		position: relative;
	}

	.menu-trigger {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.6rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all 0.15s;
		white-space: nowrap;
	}

	.menu-trigger:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--bg-hover);
	}

	.handle {
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chevron {
		flex-shrink: 0;
		transition: transform 0.15s;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	.dropdown {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		min-width: 180px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		z-index: 100;
		overflow: hidden;
		animation: dropdownIn 0.12s ease-out;
	}

	@keyframes dropdownIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-base);
		text-decoration: none;
		cursor: pointer;
		transition: background 0.12s;
		text-align: left;
	}

	.dropdown-item:hover {
		background: var(--bg-hover);
	}

	.dropdown-item svg {
		flex-shrink: 0;
		color: var(--text-secondary);
		transition: color 0.12s;
	}

	.dropdown-item:hover svg {
		color: var(--accent);
	}

	.dropdown-item.logout:hover {
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	.dropdown-item.logout:hover svg {
		color: var(--error);
	}

	.dropdown-item.logout:hover span {
		color: var(--error);
	}

	.dropdown-divider {
		height: 1px;
		background: var(--border-subtle);
		margin: 0.25rem 0;
	}
</style>
