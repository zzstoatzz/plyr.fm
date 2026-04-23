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

	// ref to the native <dialog> so we can call showModal() / close().
	// using native <dialog>+showModal() puts this in the browser's top layer,
	// which stacks above every other element on the page regardless of z-index.
	// that's what makes nested modals work correctly (e.g. confirming a restore
	// from inside the version-history sheet).
	let dialogEl = $state<HTMLDialogElement>();

	// sync the `open` prop ↔ the dialog's modal state
	$effect(() => {
		if (!dialogEl) return;
		if (open && !dialogEl.open) {
			dialogEl.showModal();
		} else if (!open && dialogEl.open) {
			dialogEl.close();
		}
	});

	function requestClose() {
		if (pending) return;
		if (!open) return;
		if (onCancel) onCancel();
		else open = false;
	}

	function handleBackdropClick(event: MouseEvent) {
		// <dialog>.showModal() renders a ::backdrop pseudo-element; clicking it
		// dispatches a click whose target === the <dialog> itself (not a child).
		// use that to close on backdrop click. keep inner clicks scoped.
		if (event.target === dialogEl) requestClose();
	}

	function handleCancel(event: Event) {
		// the native `cancel` event fires when the user presses ESC, before the
		// dialog actually closes. block it while an async confirm is in flight
		// so the user can't dismiss a pending operation mid-run.
		if (pending) event.preventDefault();
	}

	async function handleConfirm() {
		await onConfirm();
	}
</script>

<dialog
	bind:this={dialogEl}
	class="confirm-dialog"
	role="alertdialog"
	aria-labelledby={titleId}
	oncancel={handleCancel}
	onclose={requestClose}
	onclick={handleBackdropClick}
>
	<div class="modal-header">
		<h3 id={titleId}>{title}</h3>
	</div>
	<div class="modal-body">
		<p>{body}</p>
	</div>
	<div class="modal-footer">
		<button class="cancel-btn" onclick={requestClose} disabled={pending}>
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
</dialog>

<style>
	.confirm-dialog {
		background: var(--bg-primary);
		color: inherit;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-xl);
		padding: 0;
		width: 100%;
		max-width: 400px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
	}

	.confirm-dialog::backdrop {
		background: rgba(0, 0, 0, 0.5);
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
