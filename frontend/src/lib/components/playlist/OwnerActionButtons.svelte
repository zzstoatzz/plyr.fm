<script lang="ts">
	interface Props {
		isEditMode: boolean;
		isSavingOrder: boolean;
		onToggleEdit: () => void;
		onDelete: () => void;
	}

	let { isEditMode, isSavingOrder, onToggleEdit, onDelete }: Props = $props();
</script>

<button
	class="icon-btn"
	class:active={isEditMode}
	onclick={onToggleEdit}
	aria-label={isEditMode ? 'done editing' : 'edit playlist'}
	title={isEditMode ? 'done editing' : 'edit playlist'}
>
	{#if isEditMode}
		{#if isSavingOrder}
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				class="spinner"
			>
				<circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"></circle>
			</svg>
		{:else}
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="20 6 9 17 4 12"></polyline>
			</svg>
		{/if}
	{:else}
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
			<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
		</svg>
	{/if}
</button>
<button
	class="icon-btn danger"
	onclick={onDelete}
	aria-label="delete playlist"
	title="delete playlist"
>
	<svg
		width="18"
		height="18"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<polyline points="3 6 5 6 21 6"></polyline>
		<path d="m19 6-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6"></path>
		<path d="M10 11v6"></path>
		<path d="M14 11v6"></path>
		<path d="m9 6 .5-2h5l.5 2"></path>
	</svg>
</button>

<style>
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: var(--glass-btn-bg, rgba(18, 18, 18, 0.75));
		border: 1px solid var(--glass-btn-border, rgba(255, 255, 255, 0.1));
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.icon-btn:hover {
		background: var(--glass-btn-bg-hover, rgba(30, 30, 30, 0.85));
		border-color: var(--accent);
		color: var(--accent);
	}

	.icon-btn.danger:hover {
		background: rgba(239, 68, 68, 0.15);
		border-color: #ef4444;
		color: #ef4444;
	}

	.icon-btn.active {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 20%, var(--glass-btn-bg, rgba(18, 18, 18, 0.75)));
	}

	/* matches the page's cascade result: both of its .spinner rules applied,
	   with the later (bordered, 0.6s) one winning the shared declarations */
	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: var(--radius-full);
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
