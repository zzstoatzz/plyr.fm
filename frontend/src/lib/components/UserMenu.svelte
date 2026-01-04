<script lang="ts">
	import type { User, LinkedAccount } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { goto } from '$app/navigation';

	interface Props {
		user: User | null;
		onLogout: () => Promise<void>;
	}

	let { user, onLogout }: Props = $props();
	let showMenu = $state(false);
	let menuRef = $state<HTMLDivElement | null>(null);
	let switching = $state(false);
	let showAddAccountInput = $state(false);
	let newHandle = $state('');
	let addAccountError = $state('');
	let addingAccount = $state(false);

	function toggleMenu() {
		showMenu = !showMenu;
		if (!showMenu) {
			showAddAccountInput = false;
			newHandle = '';
			addAccountError = '';
		}
	}

	function closeMenu() {
		showMenu = false;
		showAddAccountInput = false;
		newHandle = '';
		addAccountError = '';
	}

	async function handleLogout() {
		closeMenu();
		await onLogout();
	}

	async function handleLogoutAll() {
		closeMenu();
		try {
			await fetch(`${API_URL}/auth/logout-all`, {
				method: 'POST',
				credentials: 'include'
			});
			goto('/');
		} catch (e) {
			console.error('logout all failed:', e);
		}
	}

	async function handleSwitchAccount(account: LinkedAccount) {
		if (switching) return;

		switching = true;
		try {
			await fetch(`${API_URL}/auth/switch-account`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ target_did: account.did })
			});
			// reload the page to update user context
			window.location.reload();
		} catch (e) {
			console.error('switch account failed:', e);
			switching = false;
		}
	}

	function showAddAccount(event: MouseEvent) {
		event.stopPropagation();
		showAddAccountInput = true;
		addAccountError = '';
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

	function handleAddAccountKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			submitAddAccount();
		} else if (event.key === 'Escape') {
			showAddAccountInput = false;
			newHandle = '';
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

			{#if hasMultipleAccounts}
				<div class="section-label">switch account</div>
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
			{/if}

			{#if showAddAccountInput}
				<div class="add-account-input">
					<input
						type="text"
						bind:value={newHandle}
						onkeydown={handleAddAccountKeydown}
						placeholder="handle.bsky.social"
						disabled={addingAccount}
						autofocus
					/>
					<button
						class="add-account-submit"
						onclick={submitAddAccount}
						disabled={addingAccount || !newHandle.trim()}
					>
						{#if addingAccount}
							...
						{:else}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polyline points="9 18 15 12 9 6"></polyline>
							</svg>
						{/if}
					</button>
				</div>
				{#if addAccountError}
					<div class="add-account-error">{addAccountError}</div>
				{/if}
			{:else}
				<button class="dropdown-item" onclick={showAddAccount}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
						<circle cx="9" cy="7" r="4"></circle>
						<line x1="19" y1="8" x2="19" y2="14"></line>
						<line x1="22" y1="11" x2="16" y2="11"></line>
					</svg>
					<span>add account</span>
				</button>
			{/if}

			<div class="dropdown-divider"></div>

			<button class="dropdown-item logout" onclick={handleLogout}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
					<polyline points="16 17 21 12 16 7"></polyline>
					<line x1="21" y1="12" x2="9" y2="12"></line>
				</svg>
				<span>logout</span>
			</button>

			{#if hasMultipleAccounts}
				<button class="dropdown-item logout-all" onclick={handleLogoutAll}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
						<polyline points="16 17 21 12 16 7"></polyline>
						<line x1="21" y1="12" x2="9" y2="12"></line>
					</svg>
					<span>logout all</span>
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
		min-width: 200px;
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

	.section-label {
		padding: 0.5rem 1rem 0.25rem;
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		font-weight: 500;
		text-transform: lowercase;
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

	.dropdown-item.logout-all {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		padding: 0.5rem 1rem;
	}

	.dropdown-item.logout-all:hover {
		background: color-mix(in srgb, var(--error) 10%, transparent);
		color: var(--error);
	}

	.dropdown-item.logout-all:hover svg {
		color: var(--error);
	}

	.dropdown-divider {
		height: 1px;
		background: var(--border-subtle);
		margin: 0.25rem 0;
	}

	.add-account-input {
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
	}

	.add-account-input input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-sm);
	}

	.add-account-input input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.add-account-input input::placeholder {
		color: var(--text-tertiary);
	}

	.add-account-submit {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		background: var(--accent);
		border: none;
		border-radius: var(--radius-base);
		color: var(--bg-primary);
		cursor: pointer;
		transition: opacity 0.12s;
	}

	.add-account-submit:hover:not(:disabled) {
		opacity: 0.9;
	}

	.add-account-submit:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.add-account-error {
		padding: 0.25rem 1rem 0.5rem;
		color: var(--error);
		font-size: var(--text-sm);
	}
</style>
