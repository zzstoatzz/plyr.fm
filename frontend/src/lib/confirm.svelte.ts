/**
 * styled, promise-based replacement for window.confirm().
 *
 * native confirm() is unreliable: iOS Safari can swallow the first tap with no
 * dialog and no request sent, and browsers let users suppress page dialogs
 * entirely. `await confirmAction({...})` resolves true/false from the shared
 * ConfirmDialog mounted once in the root layout (ConfirmHost).
 */

export interface ConfirmOptions {
	title: string;
	body: string;
	confirmText?: string;
	cancelText?: string;
	variant?: 'primary' | 'danger';
}

interface PendingConfirm extends ConfirmOptions {
	resolve: (confirmed: boolean) => void;
}

class ConfirmState {
	current = $state<PendingConfirm | null>(null);

	ask(options: ConfirmOptions): Promise<boolean> {
		// a newer request replaces an unanswered one, which counts as cancelled
		this.current?.resolve(false);
		return new Promise((resolve) => {
			this.current = { ...options, resolve };
		});
	}

	settle(confirmed: boolean): void {
		const pending = this.current;
		if (!pending) return;
		this.current = null;
		pending.resolve(confirmed);
	}
}

export const confirmState = new ConfirmState();

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
	return confirmState.ask(options);
}
