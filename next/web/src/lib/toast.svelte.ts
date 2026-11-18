export type ToastType = 'success' | 'info' | 'error';
export interface ToastAction { label: string; run: () => void }
export interface Toast { id: number; message: string; type: ToastType; action?: ToastAction }

const limit = 3;
let serial = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

class Toasts {
	items = $state.raw<Toast[]>([]);

	add(message: string, type: ToastType = 'info', duration = 3000, action?: ToastAction) {
		const id = ++serial;
		this.items = [...this.items, { id, message, type, action }].slice(-limit);
		timers.set(id, setTimeout(() => this.dismiss(id), duration));
		return id;
	}

	dismiss(id: number) {
		clearTimeout(timers.get(id));
		timers.delete(id);
		this.items = this.items.filter(item => item.id !== id);
	}
}

export const toast = new Toasts();
