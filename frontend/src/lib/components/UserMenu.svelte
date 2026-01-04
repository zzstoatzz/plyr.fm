<script lang="ts">
	import type { User, LinkedAccount } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { invalidateAll } from '$app/navigation';
	import HandleAutocomplete from './HandleAutocomplete.svelte';

	interface Props {
		user: User | null;
		onLogout: () => Promise<void>;
	}

	let { user, onLogout }: Props = $props();
	let showMenu = $state(false);
	let menuRef = $state<HTMLDivElement | null>(null);
	let switching = $state(false);
	let showAccountsSubmenu = $state(false);
	let showAddAccountForm = $state(false);
	let newHandle = $state('');
	let addAccountError = $state('');
	let addingAccount = $state(false);
	let showLogoutPrompt = $state(false);

	function toggleMenu() {
		showMenu = !showMenu;
		if (!showMenu) {
			resetSubmenus();
		}
	}

	function resetSubmenus() {
		showAccountsSubmenu = false;
		showAddAccountForm = false;
		showLogoutPrompt = false;
		newHandle = '';
		addAccountError = '';
	}

	function closeMenu() {
		showMenu = false;
		resetSubmenus();
	}

	function toggleAccountsSubmenu(event: MouseEvent) {
		event.stopPropagation();
		showAccountsSubmenu = !showAccountsSubmenu;
		if (!showAccountsSubmenu) {
			showAddAccountForm = false;
			newHandle = '';
			addAccountError = '';
		}
	}

	function handleLogoutClick(event: MouseEvent) {
		event.stopPropagation();
		if (hasMultipleAccounts) {
			// show prompt to choose: switch or logout all
			showLogoutPrompt = true;
		} else {
			// single account - just logout
			performLogout();
		}
	}

	async function performLogout() {
		closeMenu();
		await onLogout();
	}

	async function logoutAndSwitch(account: LinkedAccount) {
		closeMenu();
		try {
			const response = await fetch(`${API_URL}/auth/logout?switch_to=${encodeURIComponent(account.did)}`, {
				method: 'POST',
				credentials: 'include'
			});
			if (response.ok) {
				await invalidateAll();
			} else {
				console.error('logout with switch failed');
			}
		} catch (e) {
			console.error('logout with switch failed:', e);
		}
	}

	async function logoutAll() {
		closeMenu();
		try {
			await fetch(`${API_URL}/auth/logout-all`, {
				method: 'POST',
				credentials: 'include'
			});
			window.location.href = '/';
		} catch (e) {
			console.error('logout all failed:', e);
		}
	}

	async function handleSwitchAccount(account: LinkedAccount) {
		if (switching) return;

		switching = true;
		closeMenu();
		try {
			await fetch(`${API_URL}/auth/switch-account`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ target_did: account.did })
			});
			await invalidateAll();
		} catch (e) {
			console.error('switch account failed:', e);
		} finally {
			switching = false;
		}
	}

	function showAddAccount(event: MouseEvent) {
		event.stopPropagation();
		showAddAccountForm = true;
		addAccountError = '';
	}

	function hideAddAccount() {
		showAddAccountForm = false;
		newHandle = '';
		addAccountError = '';
	}

	function handleSelectHandle(handle: string) {
		newHandle = handle;
		// immediately submit when selecting from autocomplete
		submitAddAccount();
	}

	function handleFormSubmit(event: SubmitEvent) {
		event.preventDefault();
		submitAddAccount();
	}

	async function submitAddAccount() {
		const handle = newHandle.trim();
		if (!handle) {
			addAccountError = 'enter a handle';
			return;
		}

		addingAccount = true;
		addAccountError = '';

		try {
			const response = await fetch(`${API_URL}/auth/add-account/start`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ handle })
			});
			if (response.ok) {
				const data: { auth_url: string } = await response.json();
				window.location.href = data.auth_url;
			} else {
				const err = await response.json().catch(() => ({ detail: 'failed to add account' }));
				addAccountError = err.detail || 'failed to add account';
				addingAccount = false;
			}
		} catch (e) {
			console.error('add account failed:', e);
			addAccountError = 'network error';
			addingAccount = false;
		}
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

	// derive linked accounts (excluding current user)
	const otherAccounts = $derived(
		user?.linked_accounts?.filter((a) => a.did !== user?.did) ?? []
	);
	const hasMultipleAccounts = $derived(otherAccounts.length > 0);
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
			{#if showLogoutPrompt}
				<!-- logout prompt for multi-account users -->
				<div class="logout-prompt">
					<div class="prompt-header">stay logged in?</div>
					<div class="prompt-accounts">
						{#each otherAccounts as account}
							<button
								class="prompt-account"
								onclick={() => logoutAndSwitch(account)}
							>
								{#if account.avatar_url}
									<img src={account.avatar_url} alt="" class="account-avatar" />
								{:else}
									<div class="account-avatar placeholder">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
											<circle cx="12" cy="7" r="4"></circle>
										</svg>
									</div>
								{/if}
								<span>switch to @{account.handle}</span>
							</button>
						{/each}
					</div>
					<div class="prompt-divider"></div>
					<button class="prompt-logout-all" onclick={logoutAll}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
							<polyline points="16 17 21 12 16 7"></polyline>
							<line x1="21" y1="12" x2="9" y2="12"></line>
						</svg>
						<span>logout completely</span>
					</button>
					<button class="prompt-cancel" onclick={() => showLogoutPrompt = false}>
						cancel
					</button>
				</div>
			{:else}
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

				<!-- accounts submenu -->
				<div class="submenu-container">
					<button class="dropdown-item has-submenu" onclick={toggleAccountsSubmenu}>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
							<circle cx="9" cy="7" r="4"></circle>
							<path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
							<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
						</svg>
						<span>accounts</span>
						<svg
							class="submenu-chevron"
							class:open={showAccountsSubmenu}
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

					{#if showAccountsSubmenu}
						<div class="submenu">
							{#if showAddAccountForm}
								<!-- add account form -->
								<button class="back-button" onclick={hideAddAccount}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M15 18l-6-6 6-6"/>
									</svg>
									<span>back</span>
								</button>
								<form class="add-account-form" onsubmit={handleFormSubmit}>
									<HandleAutocomplete
										bind:value={newHandle}
										onSelect={handleSelectHandle}
										placeholder="handle.bsky.social"
										disabled={addingAccount}
									/>
									<button
										type="submit"
										class="add-account-btn"
										disabled={addingAccount || !newHandle.trim()}
									>
										{#if addingAccount}
											adding...
										{:else}
											add account
										{/if}
									</button>
									{#if addAccountError}
										<div class="add-account-error">{addAccountError}</div>
									{/if}
								</form>
							{:else}
								{#each otherAccounts as account}
									<button
										class="dropdown-item account-item"
										onclick={() => handleSwitchAccount(account)}
										disabled={switching}
									>
										{#if account.avatar_url}
											<img src={account.avatar_url} alt="" class="account-avatar" />
										{:else}
											<div class="account-avatar placeholder">
												<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
													<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
													<circle cx="12" cy="7" r="4"></circle>
												</svg>
											</div>
										{/if}
										<span class="account-handle">@{account.handle}</span>
									</button>
								{/each}

								<button class="dropdown-item add-account-trigger" onclick={showAddAccount}>
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<line x1="12" y1="5" x2="12" y2="19"></line>
										<line x1="5" y1="12" x2="19" y2="12"></line>
									</svg>
									<span>add account</span>
								</button>
							{/if}
						</div>
					{/if}
				</div>

				<div class="dropdown-divider"></div>

				<button class="dropdown-item logout" onclick={handleLogoutClick}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
						<polyline points="16 17 21 12 16 7"></polyline>
						<line x1="21" y1="12" x2="9" y2="12"></line>
					</svg>
					<span>logout</span>
				</button>
			{/if}
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
		width: 220px;
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

	.dropdown-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.dropdown-item svg {
		flex-shrink: 0;
		color: var(--text-secondary);
		transition: color 0.12s;
	}

	.dropdown-item:hover svg {
		color: var(--accent);
	}

	.account-item {
		padding: 0.5rem 1rem;
	}

	.account-avatar {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		object-fit: cover;
	}

	.account-avatar.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-tertiary);
		color: var(--text-tertiary);
	}

	.account-handle {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 1;
	}

	.account-item:hover .account-handle {
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

	.submenu-container {
		position: relative;
	}

	.has-submenu {
		justify-content: flex-start;
	}

	.has-submenu span {
		flex: 1;
	}

	.submenu-chevron {
		flex-shrink: 0;
		margin-left: auto;
		transition: transform 0.15s;
		color: var(--text-tertiary);
	}

	.submenu-chevron.open {
		transform: rotate(180deg);
	}

	.submenu {
		background: var(--bg-tertiary);
		border-top: 1px solid var(--border-subtle);
		animation: submenuIn 0.12s ease-out;
	}

	@keyframes submenuIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.submenu .dropdown-item {
		padding-left: 1.5rem;
	}

	.submenu .account-item {
		padding-left: 1.5rem;
	}

	/* back button - matches AddToMenu pattern */
	.back-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--border-subtle);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
		transition: background 0.15s;
	}

	.back-button:hover {
		background: var(--bg-hover);
		color: var(--accent);
	}

	/* add account form - matches AddToMenu create-form pattern */
	.add-account-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
	}

	.add-account-form :global(.handle-autocomplete) {
		width: 100%;
	}

	.add-account-form :global(.handle-autocomplete .input-wrapper input) {
		padding: 0.625rem 0.75rem;
		font-size: var(--text-base);
		background: var(--bg-secondary);
	}

	.add-account-form :global(.handle-autocomplete .results) {
		max-height: 180px;
	}

	.add-account-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: var(--accent);
		border: none;
		border-radius: var(--radius-base);
		color: white;
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.add-account-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.add-account-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.add-account-error {
		color: var(--error);
		font-size: var(--text-sm);
	}

	.add-account-trigger {
		color: var(--accent);
		border-top: 1px solid var(--border-subtle);
	}

	.add-account-trigger svg {
		color: var(--accent);
	}

	/* logout prompt */
	.logout-prompt {
		padding: 1rem;
	}

	.prompt-header {
		font-size: var(--text-base);
		font-weight: 500;
		color: var(--text-primary);
		margin-bottom: 0.75rem;
		text-align: center;
	}

	.prompt-accounts {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.prompt-account {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all 0.15s;
	}

	.prompt-account:hover {
		border-color: var(--accent);
		background: var(--bg-hover);
	}

	.prompt-account:hover span {
		color: var(--accent);
	}

	.prompt-divider {
		height: 1px;
		background: var(--border-subtle);
		margin: 0.75rem 0;
	}

	.prompt-logout-all {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 1rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all 0.15s;
	}

	.prompt-logout-all:hover {
		border-color: var(--error);
		color: var(--error);
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	.prompt-logout-all:hover svg {
		color: var(--error);
	}

	.prompt-cancel {
		width: 100%;
		padding: 0.5rem;
		margin-top: 0.5rem;
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: color 0.15s;
	}

	.prompt-cancel:hover {
		color: var(--text-primary);
	}
</style>
