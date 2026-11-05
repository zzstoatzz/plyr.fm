import type { QualifiedPlay } from './listening-session';
export type { QualifiedPlay } from './listening-session';

export interface PendingPlay extends QualifiedPlay {
	createdAt: number;
}

export interface PlayReceipt {
	object: 'play_receipt';
	occurrence: string;
	track_id: string;
	record: { uri: string };
	play_count: number;
	counted: boolean;
	dedup: { status: 'claimed' | 'duplicate' | 'suppressed'; window_seconds: number };
	sources: { metrics: string; dedup: string };
}

export interface PlayOutboxStorage {
	load(): Promise<PendingPlay[]>;
	put(play: PendingPlay): Promise<void>;
	delete(occurrenceId: string): Promise<void>;
}

export const PLAY_OUTBOX_LIMIT = 64;
export const PLAY_OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;

export function pendingPlay(value: unknown): PendingPlay | null {
	if (typeof value !== 'object' || value === null || !('trackId' in value) ||
		!('occurrenceId' in value) || !('createdAt' in value)) return null;
	if (typeof value.trackId !== 'string' || !value.trackId.startsWith('trk_') || value.trackId.length > 2048 ||
		typeof value.occurrenceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.occurrenceId) ||
		typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return null;
	return { trackId: value.trackId, occurrenceId: value.occurrenceId, createdAt: value.createdAt };
}

export class PlayDeliveryError extends Error {
	readonly retryable: boolean;
	constructor(message: string, retryable: boolean) {
		super(message);
		this.retryable = retryable;
	}
}

interface Options {
	storage: PlayOutboxStorage;
	send(play: QualifiedPlay): Promise<PlayReceipt>;
	onReceipt(receipt: PlayReceipt): void;
	now?(): number;
}

interface Attempt extends PendingPlay {
	attempts: number;
	nextAttemptAt: number;
	persisted: Promise<void>;
}

export class PlayOutbox {
	private items = new Map<string, Attempt>();
	private listeners = new Set<() => void>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private busy = false;
	private disposed = false;
	private hydrated = false;
	private readonly now: () => number;
	private readonly options: Options;

	constructor(options: Options) {
		this.options = options;
		this.now = options.now ?? Date.now;
		void this.hydrate();
	}

	get pendingCount(): number { return this.items.size; }

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	enqueue(play: QualifiedPlay): void {
		if (this.disposed || this.items.has(play.occurrenceId)) return;
		const pending = pendingPlay({ ...play, createdAt: this.now() });
		if (!pending) return;
		const persisted = this.options.storage.put(pending).catch(() => {
			console.warn('[plays] persistence unavailable; retaining pending play in memory');
		});
		this.items.set(play.occurrenceId, { ...pending, attempts: 0, nextAttemptAt: 0, persisted });
		this.trim();
		this.notify();
		void this.flush();
	}

	retry(): void {
		for (const item of this.items.values()) item.nextAttemptAt = 0;
		clearTimeout(this.timer);
		void this.flush();
	}

	dispose(): void {
		this.disposed = true;
		clearTimeout(this.timer);
		this.listeners.clear();
	}

	private async hydrate(): Promise<void> {
		try {
			for (const value of await this.options.storage.load()) {
				const item = pendingPlay(value);
				if (item && !this.items.has(item.occurrenceId)) {
					this.items.set(item.occurrenceId, { ...item, attempts: 0, nextAttemptAt: 0, persisted: Promise.resolve() });
				}
			}
		} catch {
			console.warn('[plays] persistence unavailable; pending plays will remain in memory');
		}
		this.hydrated = true;
		this.trim();
		this.notify();
		void this.flush();
	}

	private trim(): void {
		const now = this.now();
		for (const item of this.items.values()) {
			if (now - item.createdAt >= PLAY_OUTBOX_TTL_MS) this.remove(item.occurrenceId);
		}
		const oldest = [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt);
		for (const item of oldest.slice(0, Math.max(0, oldest.length - PLAY_OUTBOX_LIMIT))) this.remove(item.occurrenceId);
	}

	private remove(occurrenceId: string): void {
		this.items.delete(occurrenceId);
		void this.options.storage.delete(occurrenceId).catch(() => {});
	}

	private notify(): void { for (const listener of this.listeners) listener(); }

	private async flush(): Promise<void> {
		if (this.disposed || this.busy || !this.hydrated) return;
		clearTimeout(this.timer);
		this.trim();
		this.busy = true;
		try {
			for (const item of this.items.values()) {
				if (this.disposed) break;
				if (item.nextAttemptAt > this.now()) continue;
				try {
					await item.persisted;
					const receipt = await this.options.send(item);
					if (receipt.occurrence !== item.occurrenceId || receipt.track_id !== item.trackId ||
						!Number.isSafeInteger(receipt.play_count) || receipt.play_count < 0) {
						throw new PlayDeliveryError('Invalid play receipt', true);
					}
					this.remove(item.occurrenceId);
					this.options.onReceipt(receipt);
				} catch (error) {
					if (error instanceof PlayDeliveryError && !error.retryable) this.remove(item.occurrenceId);
					else {
						item.attempts++;
						item.nextAttemptAt = this.now() + Math.min(60_000, 1000 * 2 ** Math.min(item.attempts - 1, 6));
					}
				}
				this.notify();
			}
		} finally {
			this.busy = false;
			if (!this.disposed && this.items.size) {
				const next = Math.min(...[...this.items.values()].map(item => item.nextAttemptAt));
				this.timer = setTimeout(() => { void this.flush(); }, Math.max(100, next - this.now()));
			}
		}
	}
}
