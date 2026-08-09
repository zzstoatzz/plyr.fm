<script lang="ts">
	// nudge shown when some of the user's audio exists only in plyr.fm storage.
	// dismissal is a server-side per-account preference (ui_settings), never
	// global localStorage — some users legitimately rely on plyr.fm storage
	// (e.g. a PDS that rejects blob uploads) and shouldn't be re-nagged on
	// every device.
	import { preferences } from '$lib/preferences.svelte';

	let { savableCount }: { savableCount: number } = $props();

	let dismissing = $state(false);

	let dismissed = $derived(preferences.data?.ui_settings?.pds_save_banner_dismissed === true);
	// opting out of PDS audio uploads is already a statement that plyr.fm
	// storage is intentional — don't nudge those users at all
	let optedOut = $derived(preferences.data?.ui_settings?.pds_audio_uploads_enabled === false);

	async function dismiss() {
		dismissing = true;
		try {
			await preferences.updateUiSettings({ pds_save_banner_dismissed: true });
		} finally {
			dismissing = false;
		}
	}
</script>

{#if savableCount > 0 && preferences.data && !dismissed && !optedOut}
	<div class="pds-save-banner" role="status">
		<div class="banner-text">
			<strong>
				{savableCount === 1
					? 'one of your tracks relies on plyr.fm storage'
					: `${savableCount} of your tracks rely on plyr.fm storage`}
			</strong>
			<span>save the audio to your PDS so your work lives on your own server</span>
		</div>
		<div class="banner-actions">
			<a href="/portal/manage" class="banner-cta">move it to your PDS</a>
			<button class="banner-dismiss" onclick={dismiss} disabled={dismissing} title="don't show this again">
				dismiss
			</button>
		</div>
	</div>
{/if}

<style>
	.pds-save-banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.85rem 1.1rem;
		margin-bottom: 1.5rem;
		background: color-mix(in srgb, var(--accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
		border-radius: var(--radius-md);
	}

	.banner-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.banner-text strong {
		font-size: var(--text-base);
		color: var(--text-primary);
	}

	.banner-text span {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	.banner-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.banner-cta {
		padding: 0.5rem 0.9rem;
		background: var(--accent);
		color: var(--bg-primary);
		border-radius: var(--radius-base);
		font-size: var(--text-sm);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
		transition: all 0.2s;
	}

	.banner-cta:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	.banner-dismiss {
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-tertiary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all 0.15s;
	}

	.banner-dismiss:hover:not(:disabled) {
		color: var(--text-secondary);
		border-color: var(--text-secondary);
	}

	.banner-dismiss:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 600px) {
		.pds-save-banner {
			flex-direction: column;
			align-items: stretch;
		}

		.banner-actions {
			justify-content: flex-end;
		}
	}
</style>
