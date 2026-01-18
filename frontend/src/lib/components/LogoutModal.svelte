<script lang="ts">
	import { logout } from '$lib/logout.svelte';

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			logout.close();
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="logout-backdrop"
	class:open={logout.isOpen}
	role="presentation"
	onclick={handleBackdropClick}
>
	<div class="logout-modal" role="dialog" aria-modal="true" aria-label="logout options">
		<div class="logout-modal-header">switch accounts?</div>
		<div class="logout-modal-accounts">
			{#each logout.otherAccounts as account}
				<button class="logout-modal-account" onclick={() => logout.logoutAndSwitch(account)}>
					{#if account.avatar_url}
						<img src={account.avatar_url} alt="" class="logout-modal-avatar" />
					{:else}
						<div class="logout-modal-avatar placeholder">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
								<circle cx="12" cy="7" r="4"></circle>
							</svg>
						</div>
					{/if}
					<span class="logout-modal-account-text">switch to @{account.handle}</span>
				</button>
			{/each}
		</div>
		<div class="logout-modal-actions">
			<button class="logout-modal-logout" onclick={() => logout.logoutAll()}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
					<polyline points="16 17 21 12 16 7"></polyline>
					<line x1="21" y1="12" x2="9" y2="12"></line>
				</svg>
				<span>log out of all accounts</span>
			</button>
			<button class="logout-modal-cancel" onclick={() => logout.close()}>
				cancel
			</button>
		</div>
	</div>
</div>

<style>
	.logout-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s;
	}

	.logout-backdrop.open {
		opacity: 1;
		pointer-events: auto;
	}

	.logout-modal {
		width: 100%;
		max-width: 400px;
		background: color-mix(in srgb, var(--bg-secondary) 95%, transparent);
		backdrop-filter: blur(20px) saturate(180%);
		-webkit-backdrop-filter: blur(20px) saturate(180%);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		box-shadow:
			0 24px 80px color-mix(in srgb, var(--bg-primary) 50%, transparent),
			0 0 1px var(--border-subtle) inset;
		padding: 1.5rem;
		margin: 0 1rem;
	}

	.logout-modal-header {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--text-primary);
		text-align: center;
		margin-bottom: 1.25rem;
	}

	.logout-modal-accounts {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.logout-modal-account {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.875rem 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all 0.15s;
	}

	.logout-modal-account:hover {
		border-color: var(--accent);
		background: var(--bg-tertiary);
	}

	.logout-modal-account:hover .logout-modal-account-text {
		color: var(--accent);
	}

	.logout-modal-avatar {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.logout-modal-avatar.placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-tertiary);
		color: var(--text-tertiary);
	}

	.logout-modal-account-text {
		flex: 1;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.logout-modal-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.logout-modal-logout {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all 0.15s;
	}

	.logout-modal-logout:hover {
		border-color: var(--error);
		color: var(--error);
		background: color-mix(in srgb, var(--error) 10%, transparent);
	}

	.logout-modal-logout:hover svg {
		color: var(--error);
	}

	.logout-modal-cancel {
		width: 100%;
		padding: 0.625rem;
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: color 0.15s;
	}

	.logout-modal-cancel:hover {
		color: var(--text-primary);
	}
</style>
