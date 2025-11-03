// global toast notification state using Svelte 5 runes

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
	id: string;
	message: string;
	type: ToastType;
	duration: number;
	dismissible: boolean;
}

class ToastState {
	toasts = $state<Toast[]>([]);

	add(message: string, type: ToastType = 'info', duration = 3000): string {
		const id = crypto.randomUUID();
		const toast: Toast = {
			id,
			message,
			type,
			duration,
			dismissible: true
		};

		this.toasts = [toast, ...this.toasts];

		if (duration > 0) {
			setTimeout(() => this.dismiss(id), duration);
		}

		return id;
	}

	dismiss(id: string): void {
		this.toasts = this.toasts.filter(t => t.id !== id);
	}

	update(id: string, message: string, type?: ToastType): void {
		const index = this.toasts.findIndex(t => t.id === id);
		if (index !== -1) {
			this.toasts[index].message = message;
			if (type) {
				this.toasts[index].type = type;
			}
		}
	}

	success(message: string, duration = 3000): string {
		return this.add(message, 'success', duration);
	}

	error(message: string, duration = 5000): string {
		return this.add(message, 'error', duration);
	}

	info(message: string, duration = 3000): string {
		return this.add(message, 'info', duration);
	}

	warning(message: string, duration = 4000): string {
		return this.add(message, 'warning', duration);
	}
}

export const toast = new ToastState();
