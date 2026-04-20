<script lang="ts">
	interface Props {
		open: boolean;
		title: string;
		body: string;
		confirmText?: string;
		cancelText?: string;
		variant?: 'primary' | 'danger';
		pending?: boolean;
		pendingText?: string;
		onConfirm: () => void | Promise<void>;
		onCancel?: () => void;
	}

	let {
		open = $bindable(),
		title,
		body,
		confirmText = 'confirm',
		cancelText = 'cancel',
		variant = 'primary',
		pending = false,
		pendingText,
		onConfirm,
		onCancel
	}: Props = $props();

	const titleId = `confirm-dialog-title-${Math.random().toString(36).slice(2, 10)}`;

	function close() {
		if (pending) return;
		if (onCancel) {
			onCancel();
		} else {
			open = false;
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) close();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	}

	async function handleConfirm() {
		await onConfirm();
	}
</script>

{#if open}
	<div
		class="modal-overlay"
		role="presentation"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div
			class="modal"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby={titleId}
			tabindex="-1"
		>
			<div class="modal-header">
				<h3 id={titleId}>{title}</h3>
			</div>
			<div class="modal-body">
				<p>{body}</p>
			</div>
			<div class="modal-footer">
				<button class="cancel-btn" onclick={close} disabled={pending}>
					{cancelText}
				</button>
				<button
					class="confirm-btn"
					class:danger={variant === 'danger'}
					onclick={handleConfirm}
					disabled={pending}
				>
					{pending && pendingText ? pendingText : confirmText}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}

	.modal {
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		width: 100%;
		max-width: 400px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border-default);
	}

	.modal-header h3 {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--text-primary);
		margin: 0;
	}

	.modal-body {
		padding: 1.5rem;
	}

	.modal-body p {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--text-base);
		line-height: 1.5;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 1rem 1.5rem 1.25rem;
	}

	.cancel-btn,
	.confirm-btn {
		padding: 0.625rem 1.25rem;
		border-radius: var(--radius-md);
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.cancel-btn {
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
	}

	.cancel-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.confirm-btn {
		background: var(--accent);
		border: 1px solid var(--accent);
		color: white;
	}

	.confirm-btn.danger {
		background: #ef4444;
		border-color: #ef4444;
	}

	.confirm-btn:hover:not(:disabled) {
		opacity: 0.9;
	}

	.confirm-btn:disabled,
	.cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
