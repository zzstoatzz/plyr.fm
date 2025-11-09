<script lang="ts">
	import { toast } from '$lib/toast.svelte';
	import { fly } from 'svelte/transition';

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
				transition:fly={{ y: 20, duration: 500, opacity: 0 }}
			>
				<span class="toast-icon" aria-hidden="true">
					{icons[item.type]}
				</span>
				<span class="toast-message">{item.message}</span>
				{#if item.dismissible}
					<button
						class="toast-dismiss"
						onclick={() => toast.dismiss(item.id)}
						aria-label="close notification"
					>
						×
					</button>
				{/if}
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
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 300px;
		max-width: 400px;
		padding: 1rem;
		background: rgba(20, 20, 20, 0.85);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		pointer-events: auto;
		font-size: 0.9rem;
	}

	.toast-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		font-size: 1rem;
		font-weight: bold;
		flex-shrink: 0;
	}

	.toast-message {
		flex: 1;
		color: var(--text-primary);
		word-break: break-word;
	}

	.toast-dismiss {
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		font-size: 1.5rem;
		line-height: 1;
		padding: 0;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: color 0.2s;
	}

	.toast-dismiss:hover {
		color: var(--text-primary);
	}

	.toast-success {
		border-left: 3px solid var(--success);
	}

	.toast-success .toast-icon {
		color: var(--success);
	}

	.toast-error {
		border-left: 3px solid var(--error);
	}

	.toast-error .toast-icon {
		color: var(--error);
	}

	.toast-info {
		border-left: 3px solid var(--accent);
	}

	.toast-info .toast-icon {
		color: var(--accent);
	}

	.toast-warning {
		border-left: 3px solid var(--warning);
	}

	.toast-warning .toast-icon {
		color: var(--warning);
	}

	/* mobile responsiveness */
	@media (max-width: 768px) {
		.toast-container {
			bottom: calc(var(--player-height, 0px) + 0.75rem);
			left: 0.75rem;
			right: 0.75rem;
		}

		.toast {
			min-width: unset;
			max-width: unset;
			padding: 0.75rem;
			font-size: 0.85rem;
			gap: 0.5rem;
		}

		.toast-icon {
			width: 16px;
			height: 16px;
			font-size: 0.9rem;
		}

		.toast-dismiss {
			width: 16px;
			height: 16px;
			font-size: 1.25rem;
		}
	}

	/* respect reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		.toast {
			transition: opacity 0.2s;
		}
	}
</style>
