<script lang="ts">
	interface Props {
		url: string;
	}

	let { url }: Props = $props();

	let showCopied = $state(false);

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(url);
			showCopied = true;
			setTimeout(() => {
				showCopied = false;
			}, 2000);
		} catch (err) {
			console.error('failed to copy:', err);
		}
	}
</script>

<button class="share-btn" onclick={copyLink} title="share track">
	<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<circle cx="18" cy="5" r="3"></circle>
		<circle cx="6" cy="12" r="3"></circle>
		<circle cx="18" cy="19" r="3"></circle>
		<line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
		<line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
	</svg>
	{#if showCopied}
		<span class="copied">copied!</span>
	{/if}
</button>

<style>
	.share-btn {
		background: transparent;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.5rem;
		color: #888;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		transition: all 0.2s;
		position: relative;
	}

	.share-btn:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.copied {
		position: absolute;
		top: -2rem;
		left: 50%;
		transform: translateX(-50%);
		background: #1a1a1a;
		border: 1px solid var(--accent);
		color: var(--accent);
		padding: 0.25rem 0.75rem;
		border-radius: 4px;
		font-size: 0.75rem;
		white-space: nowrap;
		pointer-events: none;
		animation: fadeIn 0.2s ease-in;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(-0.25rem);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}
</style>
