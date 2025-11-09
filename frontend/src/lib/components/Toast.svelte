<script lang="ts">
	import { toast } from '$lib/toast.svelte';
	import { fade, scale } from 'svelte/transition';

	// icons for different toast types
	const icons: Record<string, string> = {
		success: '✓',
		error: '✕',
		info: 'ℹ',
		warning: '⚠'
	};
</script>

{#if toast.toasts.length > 0}
	<div class="toast-container" role="region" aria-live="polite" aria-label="notifications">
		{#each toast.toasts as item (item.id)}
			<div
				class="toast toast-{item.type}"
				role="alert"
				transition:fade={{ duration: 400 }}
			>
				<span class="toast-icon" aria-hidden="true">
					{icons[item.type]}
				</span>
				<span class="toast-message">{item.message}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		bottom: calc(var(--player-height, 0px) + 1rem);
		left: 1rem;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		pointer-events: none;
	}

	.toast {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: transparent;
		border: 1px solid var(--accent);
		color: var(--accent);
		border-radius: 4px;
		pointer-events: none;
		font-size: 0.85rem;
		font-weight: 500;
	}

	.toast-icon {
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.toast-message {
		white-space: nowrap;
	}

	.toast-success {
		border-color: var(--success);
		color: var(--success);
	}

	.toast-error {
		border-color: var(--error);
		color: var(--error);
	}

	.toast-info {
		border-color: var(--accent);
		color: var(--accent);
	}

	.toast-warning {
		border-color: var(--warning);
		color: var(--warning);
	}

	/* mobile responsiveness */
	@media (max-width: 768px) {
		.toast-container {
			bottom: calc(var(--player-height, 0px) + 0.75rem);
			left: 0.75rem;
		}

		.toast {
			padding: 0.4rem 0.75rem;
			font-size: 0.8rem;
		}

		.toast-icon {
			font-size: 0.8rem;
		}
	}

	/* respect reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		.toast {
			transition: opacity 0.2s;
		}
	}
</style>
