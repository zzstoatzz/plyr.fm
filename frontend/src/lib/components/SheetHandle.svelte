<script lang="ts">
	let { onClose, label }: { onClose: () => void; label: string } = $props();
</script>

<button type="button" data-sheet-handle aria-label={label} onclick={onClose}>
	<span></span>
</button>

<style>
	button {
		display: flex;
		align-items: center;
		justify-content: center;
		align-self: center;
		width: 100%;
		min-height: 44px;
		padding: 0;
		border: none;
		background: transparent;
		border-radius: var(--radius-xl);
		touch-action: auto;
		user-select: none;
		-webkit-user-select: none;
		cursor: grab;
	}

	button:active {
		cursor: grabbing;
	}

	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -4px;
	}

	span {
		width: 36px;
		height: 4px;
		border-radius: var(--radius-full);
		background: var(--border-default);
	}
</style>
