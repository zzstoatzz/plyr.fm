/**
 * Microphone capture for /record: the MediaRecorder, its clock, and the live
 * input level, kept together so the page only deals with what was recorded.
 */

export class RecorderError extends Error {}

export interface RecorderOptions {
	/** hard stop, in seconds. */
	maxSeconds: number;
	/** fires once, this many seconds in, so the page can warn. */
	warnAtSeconds?: number;
	onWarn?: () => void;
	onStop: (_blob: Blob, _elapsedSeconds: number) => void;
	/** skip the level meter entirely (e.g. prefers-reduced-motion). */
	measureLevel?: boolean;
}

// mp4/m4a first: it is web-playable, so a recording can go straight into a
// permissioned space, and a public one skips transcoding. webm/ogg remain the
// fallback for browsers that record nothing else.
const MIME_CANDIDATES = [
	'audio/mp4',
	'audio/mp4;codecs=mp4a.40.2',
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus',
	'audio/ogg'
];

export function pickSupportedMime(): string | null {
	if (typeof MediaRecorder === 'undefined') return null;
	return MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c)) ?? null;
}

export function extensionForMime(mime: string): string {
	if (mime.includes('mp4')) return 'm4a';
	if (mime.includes('ogg')) return 'ogg';
	return 'webm';
}

export class Recorder {
	/** seconds captured so far, ticking while recording. */
	elapsedSeconds = $state(0);
	/** live mic amplitude, 0..1, for ambient UI. always 0 when not measuring. */
	inputLevel = $state(0);
	recording = $state(false);

	#options: RecorderOptions;
	#mediaRecorder: MediaRecorder | null = null;
	#stream: MediaStream | null = null;
	#chunks: Blob[] = [];
	#timer: number | null = null;
	#warned = false;
	#audioContext: AudioContext | null = null;
	#analyser: AnalyserNode | null = null;
	#levelFrame: number | null = null;

	constructor(options: RecorderOptions) {
		this.#options = options;
	}

	/** request the mic and start capturing. throws RecorderError with a reason. */
	async start(): Promise<void> {
		try {
			this.#stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (e) {
			console.error('mic permission error:', e);
			throw new RecorderError('microphone permission denied');
		}

		this.#chunks = [];
		const mime = pickSupportedMime();
		try {
			this.#mediaRecorder = new MediaRecorder(
				this.#stream,
				mime ? { mimeType: mime } : undefined
			);
		} catch (e) {
			console.error('mediarecorder init error:', e);
			this.#releaseStream();
			throw new RecorderError('your browser does not support audio recording');
		}

		this.#mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.#chunks.push(e.data);
		};
		this.#mediaRecorder.onstop = () => this.#finalize();
		this.#mediaRecorder.start();
		this.recording = true;
		this.#startClock();
		if (this.#options.measureLevel !== false) this.#startLevelMeter();
	}

	stop(): void {
		if (this.#mediaRecorder && this.#mediaRecorder.state !== 'inactive') {
			this.#mediaRecorder.stop();
		}
		this.#releaseStream();
		this.#stopClock();
		this.#stopLevelMeter();
		this.recording = false;
	}

	/** stop everything without emitting a recording (unmount, navigation). */
	dispose(): void {
		this.#stopClock();
		this.#stopLevelMeter();
		if (this.#mediaRecorder && this.#mediaRecorder.state !== 'inactive') {
			try {
				this.#mediaRecorder.onstop = null;
				this.#mediaRecorder.stop();
			} catch (e) {
				console.error('error stopping recorder on destroy:', e);
			}
		}
		this.#releaseStream();
		this.recording = false;
	}

	#finalize(): void {
		const mime = this.#mediaRecorder?.mimeType ?? 'audio/webm';
		this.#options.onStop(new Blob(this.#chunks, { type: mime }), this.elapsedSeconds);
	}

	#releaseStream(): void {
		this.#stream?.getTracks().forEach((t) => t.stop());
		this.#stream = null;
	}

	#startClock(): void {
		this.#stopClock();
		this.elapsedSeconds = 0;
		this.#warned = false;
		const { maxSeconds, warnAtSeconds, onWarn } = this.#options;
		this.#timer = window.setInterval(() => {
			this.elapsedSeconds += 1;
			if (warnAtSeconds && this.elapsedSeconds === warnAtSeconds && !this.#warned) {
				this.#warned = true;
				onWarn?.();
			}
			if (this.elapsedSeconds >= maxSeconds) this.stop();
		}, 1000);
	}

	#stopClock(): void {
		if (this.#timer !== null) {
			window.clearInterval(this.#timer);
			this.#timer = null;
		}
	}

	#startLevelMeter(): void {
		if (!this.#stream) return;
		try {
			this.#audioContext = new AudioContext();
			this.#analyser = this.#audioContext.createAnalyser();
			this.#analyser.fftSize = 256;
			this.#audioContext.createMediaStreamSource(this.#stream).connect(this.#analyser);
			const samples = new Uint8Array(this.#analyser.frequencyBinCount);
			const tick = () => {
				if (!this.#analyser) return;
				this.#analyser.getByteTimeDomainData(samples);
				let peak = 0;
				for (const sample of samples) {
					peak = Math.max(peak, Math.abs(sample - 128) / 128);
				}
				// ease downward so the level settles instead of strobing
				this.inputLevel = Math.max(peak, this.inputLevel * 0.82);
				this.#levelFrame = requestAnimationFrame(tick);
			};
			tick();
		} catch (e) {
			console.error('could not read input level:', e);
		}
	}

	#stopLevelMeter(): void {
		if (this.#levelFrame !== null) {
			cancelAnimationFrame(this.#levelFrame);
			this.#levelFrame = null;
		}
		this.#analyser = null;
		void this.#audioContext?.close().catch(() => undefined);
		this.#audioContext = null;
		this.inputLevel = 0;
	}
}
