<script lang="ts">
	import { downloadAsk } from '$lib/download-ask.svelte';

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			downloadAsk.close();
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="ask-backdrop"
	class:open={downloadAsk.isOpen}
	role="presentation"
	onclick={handleBackdropClick}
>
	<div class="ask-modal" role="dialog" aria-modal="true" aria-label="support the artist">
		<div class="ask-header">before you download…</div>
		<p class="ask-body">
			{downloadAsk.artistName} asks listeners to consider supporting their work
		</p>
		<div class="ask-actions">
			<a
				class="ask-support"
				href={downloadAsk.supportHref}
				target="_blank"
				rel="noopener noreferrer"
			>
				support {downloadAsk.artistName}
			</a>
			<button class="ask-continue" onclick={() => downloadAsk.continueDownload()}>
				continue to download
			</button>
		</div>
	</div>
</div>

<style>
	.ask-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 9999;
		display: none;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.ask-backdrop.open {
		display: flex;
	}

	.ask-modal {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		max-width: 22rem;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		text-align: center;
	}

	.ask-header {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text-primary);
	}

	.ask-body {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--text-base);
	}

	.ask-actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.ask-support {
		display: block;
		padding: 0.7rem 1rem;
		background: var(--accent);
		color: var(--bg-primary);
		border-radius: var(--radius-md);
		font-weight: 600;
		text-decoration: none;
		transition: opacity 0.15s;
	}

	.ask-support:hover {
		opacity: 0.9;
	}

	.ask-continue {
		padding: 0.6rem 1rem;
		background: transparent;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: all 0.15s;
	}

	.ask-continue:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
