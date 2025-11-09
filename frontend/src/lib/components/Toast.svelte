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
				transition:fade={{ duration: 600, easing: (t) => t * t }}
			>
				<span class="toast-icon" aria-hidden="true">
					{icons[item.type]}
				</span>
				<span class="toast-prefix">queued</span>
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
		padding: 0.4rem 0.9rem;
		background: transparent;
		border: none;
		border-radius: 4px;
		pointer-events: none;
		font-size: 0.85rem;
	}

	.toast-icon {
		font-size: 0.8rem;
		flex-shrink: 0;
		opacity: 0.7;
	}

	.toast-prefix {
		opacity: 0.5;
		font-weight: 400;
		font-size: 0.8rem;
	}

	.toast-message {
		max-width: 250px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}

	.toast-success .toast-icon {
		color: var(--success);
	}

	.toast-success .toast-prefix {
		color: var(--text-tertiary);
	}

	.toast-success .toast-message {
		color: var(--text-primary);
	}

	.toast-error .toast-icon {
		color: var(--error);
	}

	.toast-error .toast-prefix {
		color: var(--text-tertiary);
	}

	.toast-error .toast-message {
		color: var(--text-primary);
	}

	.toast-info .toast-icon {
		color: var(--accent);
	}

	.toast-info .toast-prefix {
		color: var(--text-tertiary);
	}

	.toast-info .toast-message {
		color: var(--text-primary);
	}

	.toast-warning .toast-icon {
		color: var(--warning);
	}

	.toast-warning .toast-prefix {
		color: var(--text-tertiary);
	}

	.toast-warning .toast-message {
		color: var(--text-primary);
	}

	/* mobile responsiveness */
	@media (max-width: 768px) {
		.toast-container {
			bottom: calc(var(--player-height, 0px) + 0.75rem);
			left: 0.75rem;
		}

		.toast {
			padding: 0.35rem 0.7rem;
			font-size: 0.8rem;
		}

		.toast-icon {
			font-size: 0.75rem;
		}

		.toast-prefix {
			font-size: 0.75rem;
		}

		.toast-message {
			max-width: 200px;
		}
	}

	/* respect reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		.toast {
			transition: opacity 0.2s;
		}
	}
</style>
