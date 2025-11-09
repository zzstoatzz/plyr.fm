<script lang="ts">
	import { toast } from '$lib/toast.svelte';
	import { fade, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	// icons for different toast types
	const icons: Record<string, string> = {
		success: '✓',
		error: '✕',
		info: 'ℹ',
		warning: '⚠'
	};

	let hasToasts = $derived(toast.toasts.length > 0);
</script>

<div class="notification-zone">
	{#if hasToasts}
		<div class="notifications">
			{#each toast.toasts as item (item.id)}
				<div
					class="notification notification-{item.type}"
					role="alert"
					transition:scale={{ duration: 500, easing: quintOut, start: 0.9, opacity: 0 }}
				>
					<span class="notification-icon" aria-hidden="true">
						{icons[item.type]}
					</span>
					<span class="notification-prefix">queued</span>
					<span class="notification-message">{item.message}</span>
				</div>
			{/each}
		</div>
	{:else}
		<div class="empty-state" transition:fade={{ duration: 300 }}>
			<pre class="ascii-art">{`
  ♪ ┈┈┈┈┈┈┈┈┈┈ ♪

     plyr.fm

  ♪ ┈┈┈┈┈┈┈┈┈┈ ♪
			`}</pre>
			<p class="tagline">stream audio on atproto</p>
		</div>
	{/if}
</div>

<style>
	.notification-zone {
		min-height: 120px;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 2rem 0 3rem;
		position: relative;
	}

	.notifications {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
	}

	.notification {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		background: rgba(10, 10, 10, 0.4);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 16px;
		font-size: 0.9rem;
		max-width: 500px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
	}

	.notification-icon {
		font-size: 0.85rem;
		flex-shrink: 0;
		opacity: 0.8;
		margin-top: 0.1rem;
	}

	.notification-prefix {
		opacity: 0.5;
		font-weight: 400;
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.notification-message {
		max-width: 400px;
		font-weight: 500;
		word-wrap: break-word;
		overflow-wrap: break-word;
		hyphens: auto;
	}

	.notification-success .notification-icon {
		color: var(--success);
	}

	.notification-success .notification-prefix {
		color: var(--text-tertiary);
	}

	.notification-success .notification-message {
		color: var(--text-primary);
	}

	.notification-error .notification-icon {
		color: var(--error);
	}

	.notification-error .notification-prefix {
		color: var(--text-tertiary);
	}

	.notification-error .notification-message {
		color: var(--text-primary);
	}

	.notification-info .notification-icon {
		color: var(--accent);
	}

	.notification-info .notification-prefix {
		color: var(--text-tertiary);
	}

	.notification-info .notification-message {
		color: var(--text-primary);
	}

	.notification-warning .notification-icon {
		color: var(--warning);
	}

	.notification-warning .notification-prefix {
		color: var(--text-tertiary);
	}

	.notification-warning .notification-message {
		color: var(--text-primary);
	}

	.empty-state {
		text-align: center;
		opacity: 0.6;
	}

	.ascii-art {
		font-family: inherit;
		color: var(--text-tertiary);
		font-size: 0.85rem;
		line-height: 1.4;
		margin: 0;
	}

	.tagline {
		color: var(--text-muted);
		font-size: 0.8rem;
		margin: 0.5rem 0 0;
	}

	@media (max-width: 768px) {
		.notification-zone {
			min-height: 100px;
			margin: 1.5rem 0 2rem;
		}

		.notification {
			padding: 0.6rem 1rem;
			font-size: 0.85rem;
			max-width: 90vw;
			border-radius: 12px;
		}

		.notification-icon {
			font-size: 0.8rem;
		}

		.notification-prefix {
			font-size: 0.8rem;
		}

		.notification-message {
			max-width: calc(90vw - 6rem);
		}

		.ascii-art {
			font-size: 0.75rem;
		}

		.tagline {
			font-size: 0.75rem;
		}
	}
</style>
