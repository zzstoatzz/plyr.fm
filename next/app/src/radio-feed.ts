import type { RadioSnapshot } from './radio';

export interface RadioFeedState {
	readonly snapshot: RadioSnapshot | undefined;
	readonly error: string;
}

const empty: RadioFeedState = Object.freeze({ snapshot: undefined, error: '' });

export class RadioFeed {
	private state = empty;
	private listeners = new Set<() => void>();
	private generation = 0;
	private controller: AbortController | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly load: (signal: AbortSignal) => Promise<RadioSnapshot>;
	private readonly intervalMs: number;
	private readonly timeoutMs: number;

	constructor(
		load: (signal: AbortSignal) => Promise<RadioSnapshot>,
		intervalMs = 5000,
		timeoutMs = 10_000,
	) {
		this.load = load;
		this.intervalMs = intervalMs;
		this.timeoutMs = timeoutMs;
	}

	getSnapshot = (): RadioFeedState => this.state;

	subscribe = (listener: () => void): (() => void) => {
		const subscription = () => listener();
		this.listeners.add(subscription);
		if (this.listeners.size === 1) void this.poll(++this.generation);
		return () => {
			if (!this.listeners.delete(subscription)) return;
			if (this.listeners.size) return;
			this.generation++;
			clearTimeout(this.timer);
			this.controller?.abort();
			this.controller = undefined;
			this.state = empty;
		};
	};

	private async poll(generation: number): Promise<void> {
		if (!this.active(generation)) return;
		const controller = new AbortController();
		this.controller = controller;
		let abort: () => void = () => {};
		const cancelled = new Promise<never>((_, reject) => {
			abort = () => reject(new Error('Radio read cancelled'));
			controller.signal.addEventListener('abort', abort, { once: true });
		});
		const deadline = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const snapshot = await Promise.race([this.load(controller.signal), cancelled]);
			if (!this.active(generation)) return;
			this.state = Object.freeze({ snapshot, error: '' });
			this.notify();
		} catch {
			if (!this.active(generation)) return;
			this.state = Object.freeze({ snapshot: this.state.snapshot, error: 'Could not reach this station. Retrying…' });
			this.notify();
		} finally {
			clearTimeout(deadline);
			controller.signal.removeEventListener('abort', abort);
			if (this.controller === controller) this.controller = undefined;
			if (this.active(generation)) this.timer = setTimeout(() => { void this.poll(generation); }, this.intervalMs);
		}
	}

	private active(generation: number): boolean {
		return this.generation === generation && this.listeners.size > 0;
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
