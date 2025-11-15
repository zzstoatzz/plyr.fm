<script lang="ts">
	import { onMount } from 'svelte';
	import { API_URL } from '$lib/config';

	let needsMigration = $state(false);
	let oldRecordCount = $state(0);
	let oldCollection = $state<string | null>(null);
	let newCollection = $state<string | null>(null);
	let userDid = $state<string | null>(null);
	let migrating = $state(false);
	let migrated = $state(false);
	let error = $state('');
	let dismissed = $state(false);

	// check migration status on mount
	onMount(() => {
		checkMigrationStatus();
	});

	// check if migration is needed
	export async function checkMigrationStatus(): Promise<void> {
		// check if user already dismissed this (using a generic key since we don't have session_id)
		const dismissedKey = 'migration_dismissed';
		if (localStorage.getItem(dismissedKey) === 'true') {
			dismissed = true;
			return;
		}

		try {
			const response = await fetch(`${API_URL}/migration/check`, {
				credentials: 'include'
			});

			if (response.ok) {
				const data = await response.json();
				needsMigration = data.needs_migration;
				oldRecordCount = data.old_record_count;
				oldCollection = data.old_collection;
				newCollection = data.new_collection;
				userDid = data.did;
			}
		} catch (e) {
			console.error('failed to check migration status:', e);
		}
	}

	async function migrateRecords(): Promise<void> {
		migrating = true;
		error = '';

		try {
			const response = await fetch(`${API_URL}/migration/migrate`, {
				method: 'POST',
				credentials: 'include'
			});

			if (response.ok) {
				const data = await response.json();
				if (data.migrated_count > 0) {
					migrated = true;
					setTimeout(() => {
						needsMigration = false;
					}, 5000); // hide banner after 5s
				} else if (data.failed_count > 0) {
					error = `migration failed for ${data.failed_count} tracks`;
				}
			} else {
				const errorData = await response.json();
				error = errorData.detail || 'migration failed';
			}
		} catch (e) {
			console.error('migration error:', e);
			error = 'network error during migration';
		} finally {
			migrating = false;
		}
	}

	function dismiss(): void {
		dismissed = true;
		needsMigration = false;

		// remember dismissal
		localStorage.setItem('migration_dismissed', 'true');
	}
</script>

{#if needsMigration && !dismissed}
	<div class="migration-banner">
		<div class="migration-content">
			<div class="migration-message">
				<strong>collection migration available</strong>
				{#if oldCollection && newCollection}
					<p>
						your tracks are currently stored in the <code class="collection-name">{oldCollection}</code> collection.
						we've migrated to <code class="collection-name">{newCollection}</code> to follow atproto reverse-DNS conventions.
					</p>
				{:else}
					<p>
						we've updated our record namespace to follow atproto reverse-DNS conventions.
					</p>
				{/if}
				{#if oldRecordCount > 0}
					<p>
						you have {oldRecordCount} {oldRecordCount === 1 ? 'track' : 'tracks'} to migrate.
						{#if userDid && oldCollection && newCollection}
							view your
							<a href="https://pdsls.dev/at://{userDid}/{oldCollection}" target="_blank" rel="noopener noreferrer" class="collection-link">old collection</a>
							or
							<a href="https://pdsls.dev/at://{userDid}/{newCollection}" target="_blank" rel="noopener noreferrer" class="collection-link">new collection</a>
							on pdsls.dev.
						{/if}
					</p>
				{/if}
				{#if error}
					<p class="error">{error}</p>
				{/if}
				{#if migrated}
					<div class="success-message">
						<div class="success-icon">✓</div>
						<div>
							<p class="success-title">migration complete!</p>
							<p class="success-detail">successfully migrated {oldRecordCount} {oldRecordCount === 1 ? 'track' : 'tracks'} to {newCollection}</p>
						</div>
					</div>
				{/if}
			</div>

			{#if !migrated}
				<div class="migration-actions">
					<button
						class="migrate-button"
						onclick={migrateRecords}
						disabled={migrating}
					>
						{migrating ? 'migrating...' : 'migrate now'}
					</button>
					<button
						class="dismiss-button"
						onclick={dismiss}
						disabled={migrating}
					>
						remind me later
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.migration-banner {
		background: var(--background-alt, #1a1a1a);
		border: 1px solid var(--border-color, #333);
		border-radius: 8px;
		padding: 1rem;
		margin-bottom: 1.5rem;
	}

	.migration-content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.migration-message {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.migration-message strong {
		font-size: 1.1em;
		color: var(--text-primary, #fff);
	}

	.migration-message p {
		margin: 0;
		color: var(--text-secondary, #aaa);
		font-size: 0.9em;
	}

	.error {
		color: var(--error-color, #ff6b6b);
	}

	.success-message {
		display: flex;
		align-items: center;
		gap: 1rem;
		background: rgba(81, 207, 102, 0.1);
		border: 1px solid rgba(81, 207, 102, 0.3);
		border-radius: 6px;
		padding: 1rem;
		animation: slideIn 0.3s ease-out;
	}

	.success-icon {
		font-size: 2rem;
		color: var(--success-color, #51cf66);
		animation: checkmark 0.5s ease-out;
	}

	.success-title {
		font-weight: 600;
		color: var(--success-color, #51cf66);
		margin: 0;
	}

	.success-detail {
		color: var(--text-secondary, #aaa);
		margin: 0.25rem 0 0 0;
		font-size: 0.85em;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes checkmark {
		0% {
			transform: scale(0);
		}
		50% {
			transform: scale(1.2);
		}
		100% {
			transform: scale(1);
		}
	}

	.collection-name {
		background: rgba(255, 255, 255, 0.05);
		padding: 0.15em 0.4em;
		border-radius: 3px;
		font-family: monospace;
		font-size: 0.95em;
		color: var(--text-primary, #fff);
	}

	.collection-link {
		color: var(--accent, #6a9fff);
		text-decoration: none;
		border-bottom: 1px solid transparent;
		transition: border-color 0.2s;
	}

	.collection-link:hover {
		border-bottom-color: var(--accent, #6a9fff);
	}

	.migration-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.migrate-button,
	.dismiss-button {
		padding: 0.5rem 1rem;
		border-radius: 4px;
		font-size: 0.9em;
		font-family: inherit;
		cursor: pointer;
		border: none;
		transition: opacity 0.2s;
	}

	.migrate-button {
		background: var(--primary-color, #007bff);
		color: white;
	}

	.migrate-button:hover:not(:disabled) {
		opacity: 0.9;
	}

	.dismiss-button {
		background: transparent;
		color: var(--text-secondary, #aaa);
		border: 1px solid var(--border-color, #333);
	}

	.dismiss-button:hover:not(:disabled) {
		background: var(--background-hover, #222);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (min-width: 640px) {
		.migration-content {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
		}

		.migration-actions {
			flex-shrink: 0;
		}
	}
</style>
