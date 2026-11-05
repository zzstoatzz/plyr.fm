export interface QualifiedPlay {
	trackId: string;
	occurrenceId: string;
}

export interface ListeningObservation {
	positionSeconds: number;
	durationSeconds?: number | null;
	playing: boolean;
	buffering: boolean;
	monotonicMs: number;
	playbackRate?: number;
}

interface Occurrence extends QualifiedPlay {
	token: number;
	durationSeconds: number | null;
	listenedSeconds: number;
	qualified: boolean;
	suspended: boolean;
	previous: ListeningObservation | null;
}

function positive(value: number | null | undefined): value is number {
	return value !== undefined && value !== null && Number.isFinite(value) && value > 0;
}

export class ListeningSession {
	private sequence = 0;
	private current: Occurrence | null = null;

	begin(trackId: string, occurrenceId: string, durationSeconds?: number | null): number {
		const token = ++this.sequence;
		this.current = {
			trackId, occurrenceId, token,
			durationSeconds: positive(durationSeconds) ? durationSeconds : null,
			listenedSeconds: 0, qualified: false, suspended: false, previous: null
		};
		return token;
	}

	discontinue(token: number): void {
		if (this.current?.token !== token) return;
		this.current.previous = null;
		this.current.suspended = true;
	}

	settle(token: number): void {
		if (this.current?.token !== token) return;
		this.current.previous = null;
		this.current.suspended = false;
	}

	stop(): void {
		this.sequence++;
		this.current = null;
	}

	observe(token: number, observation: ListeningObservation): QualifiedPlay | null {
		const current = this.current;
		if (!current || current.token !== token || current.qualified || current.suspended) return null;
		if (!Number.isFinite(observation.positionSeconds) || observation.positionSeconds < 0 ||
			!Number.isFinite(observation.monotonicMs)) {
			current.previous = null;
			return null;
		}
		if (positive(observation.durationSeconds)) current.durationSeconds = observation.durationSeconds;
		const previous = current.previous;
		current.previous = observation;
		if (previous && previous.playing && !previous.buffering) {
			const elapsed = (observation.monotonicMs - previous.monotonicMs) / 1000;
			const progress = observation.positionSeconds - previous.positionSeconds;
			const rate = positive(observation.playbackRate) ? observation.playbackRate : 1;
			if (elapsed > 0 && progress > 0 && progress <= elapsed * rate + 0.25) {
				current.listenedSeconds += Math.min(progress / rate, elapsed);
			}
		}
		const threshold = current.durationSeconds === null ? 30 : Math.min(30, current.durationSeconds / 2);
		if (current.listenedSeconds < threshold) return null;
		current.qualified = true;
		return { trackId: current.trackId, occurrenceId: current.occurrenceId };
	}

	get listenedSeconds(): number {
		return this.current?.listenedSeconds ?? 0;
	}
}
