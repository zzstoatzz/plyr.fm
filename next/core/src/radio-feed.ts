import { nextRead, type RadioSnapshot } from './radio.ts';

export interface RadioFeedState {
	readonly snapshot: RadioSnapshot | undefined;
	readonly error: string;
}

const empty: RadioFeedState = Object.freeze({ snapshot: undefined, error: '' });

/**
 * One station's state, read while anything watches it. Reads land just after each song change rather than on a fixed beat.
 * The last snapshot outlives its watchers, so coming back to a station draws it at once while a fresh read runs.
 */
export class RadioFeed {
	private state = empty;
	private listeners = new Set<() => void>();
	private generation = 0;
	private controller: AbortController | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly load: (signal: AbortSignal) => Promise<RadioSnapshot>;
	private readonly intervalMs: number;
	private readonly timeoutMs: number;
	private readonly retryMs: number;

	constructor(
		load: (signal: AbortSignal) => Promise<RadioSnapshot>,
		intervalMs = 30_000,
		timeoutMs = 10_000,
		retryMs = 5000,
	) {
		this.load = load;
		this.intervalMs = intervalMs;
		this.timeoutMs = timeoutMs;
		this.retryMs = retryMs;
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
			if (this.state.error) this.state = Object.freeze({ snapshot: this.state.snapshot, error: '' });
		};
	};

	private async poll(generation: number): Promise<void> {
		if (!this.active(generation)) return;
		const controller = new AbortController();
		this.controller = controller;
		let abort: () => void = () => {};
		const cancelled = new Promise<never>((_, reject) => {
			abort = () => reject(new Error('radio read cancelled'));
			controller.signal.addEventListener('abort', abort, { once: true });
		});
		const deadline = setTimeout(() => controller.abort(), this.timeoutMs);
		let delay = this.retryMs;
		try {
			const snapshot = await Promise.race([this.load(controller.signal), cancelled]);
			if (!this.active(generation)) return;
			this.state = Object.freeze({ snapshot, error: '' });
			delay = nextRead(snapshot, this.intervalMs);
			this.notify();
		} catch {
			if (!this.active(generation)) return;
			this.state = Object.freeze({ snapshot: this.state.snapshot, error: 'could not reach this station. retrying…' });
			this.notify();
		} finally {
			clearTimeout(deadline);
			controller.signal.removeEventListener('abort', abort);
			if (this.controller === controller) this.controller = undefined;
			if (this.active(generation)) this.timer = setTimeout(() => { void this.poll(generation); }, delay);
		}
	}

	private active(generation: number): boolean {
		return this.generation === generation && this.listeners.size > 0;
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
