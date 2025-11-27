<script lang="ts">
	import { toast } from '$lib/toast.svelte';
	import { fade } from 'svelte/transition';

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
				<span class="toast-message">
					{item.message}
					{#if item.action}
						<a href={item.action.href} target="_blank" rel="noopener noreferrer" class="toast-action">
							{item.action.label}
						</a>
					{/if}
				</span>
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
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: rgba(10, 10, 10, 0.6);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		pointer-events: none;
		font-size: 0.85rem;
		max-width: 450px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
	}

	.toast-icon {
		font-size: 0.8rem;
		flex-shrink: 0;
		opacity: 0.7;
		margin-top: 0.1rem;
	}

	.toast-message {
		max-width: 350px;
		font-weight: 500;
		word-wrap: break-word;
		overflow-wrap: break-word;
		hyphens: auto;
	}

	.toast-action {
		color: var(--accent);
		text-decoration: underline;
		pointer-events: auto;
		margin-left: 0.5rem;
	}

	.toast-action:hover {
		opacity: 0.8;
	}

	.toast-success .toast-icon {
		color: var(--success);
	}

	.toast-success .toast-message {
		color: var(--text-primary);
	}

	.toast-error .toast-icon {
		color: var(--error);
	}

	.toast-error .toast-message {
		color: var(--text-primary);
	}

	.toast-info .toast-icon {
		color: var(--accent);
	}

	.toast-info .toast-message {
		color: var(--text-primary);
	}

	.toast-warning .toast-icon {
		color: var(--warning);
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
			max-width: 90vw;
		}

		.toast-icon {
			font-size: 0.75rem;
		}

		.toast-message {
			max-width: calc(90vw - 4rem);
		}
	}

	/* respect reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		.toast {
			transition: opacity 0.2s;
		}
	}
</style>
