export class PlayMetrics {
	private counts = new Map<string, number>();
	private listeners = new Map<string, Set<() => void>>();

	get(trackId: string): number | undefined {
		return this.counts.get(trackId);
	}

	observe(trackId: string, count: number): void {
		if (!Number.isSafeInteger(count) || count < 0 || count <= (this.counts.get(trackId) ?? -1)) return;
		if (!this.counts.has(trackId) && this.counts.size >= 1024) {
			for (const candidate of this.counts.keys()) {
				if (this.listeners.has(candidate)) continue;
				this.counts.delete(candidate);
				break;
			}
		}
		this.counts.set(trackId, count);
		for (const listener of this.listeners.get(trackId) ?? []) listener();
	}

	subscribe(trackId: string, listener: () => void): () => void {
		let listeners = this.listeners.get(trackId);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(trackId, listeners);
		}
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) this.listeners.delete(trackId);
		};
	}
}

export const playMetrics = new PlayMetrics();
