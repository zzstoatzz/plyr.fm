<script lang="ts">
	import { API_URL } from '$lib/config';

	let needsMigration = $state(false);
	let oldRecordCount = $state(0);
	let migrating = $state(false);
	let migrated = $state(false);
	let error = $state('');
	let dismissed = $state(false);

	// check if migration is needed
	export async function checkMigrationStatus(): Promise<void> {
		const sessionId = localStorage.getItem('session_id');
		if (!sessionId) return;

		// check if user already dismissed this
		const dismissedKey = `migration_dismissed_${sessionId}`;
		if (localStorage.getItem(dismissedKey) === 'true') {
			dismissed = true;
			return;
		}

		try {
			const response = await fetch(`${API_URL}/migration/check`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			if (response.ok) {
				const data = await response.json();
				needsMigration = data.needs_migration;
				oldRecordCount = data.old_record_count;
			}
		} catch (e) {
			console.error('failed to check migration status:', e);
		}
	}

	async function migrateRecords(): Promise<void> {
		migrating = true;
		error = '';

		const sessionId = localStorage.getItem('session_id');
		if (!sessionId) {
			error = 'not authenticated';
			migrating = false;
			return;
		}

		try {
			const response = await fetch(`${API_URL}/migration/migrate`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			if (response.ok) {
				const data = await response.json();
				if (data.migrated_count > 0) {
					migrated = true;
					setTimeout(() => {
						needsMigration = false;
					}, 3000); // hide banner after 3s
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
		const sessionId = localStorage.getItem('session_id');
		if (sessionId) {
			localStorage.setItem(`migration_dismissed_${sessionId}`, 'true');
		}
	}
</script>

{#if needsMigration && !dismissed}
	<div class="migration-banner">
		<div class="migration-content">
			<div class="migration-message">
				<strong>namespace update</strong>
				<p>
					we've updated our record namespace to follow atproto conventions.
					{#if oldRecordCount > 0}
						you have {oldRecordCount} {oldRecordCount === 1 ? 'track' : 'tracks'} that need to be migrated.
					{/if}
				</p>
				{#if error}
					<p class="error">{error}</p>
				{/if}
				{#if migrated}
					<p class="success">✓ migration complete! your tracks are now on the new namespace.</p>
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

	.success {
		color: var(--success-color, #51cf66);
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
