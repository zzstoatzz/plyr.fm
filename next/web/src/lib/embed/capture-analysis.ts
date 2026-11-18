import type { EmbedAnalysisStatus, EmbedEvent } from '@plyr/next-core/embed-events';

type CapturableAudio = HTMLAudioElement & { captureStream(): MediaStream };
function canCapture(audio: HTMLAudioElement): audio is CapturableAudio {
	return 'captureStream' in audio && typeof audio.captureStream === 'function';
}

export class EmbedCaptureAnalysis {
	readonly supported: boolean;
	#subscribed = false;
	#audio: HTMLAudioElement | undefined;
	#context: AudioContext | undefined;
	#stream: MediaStream | undefined;
	#source: MediaStreamAudioSourceNode | undefined;
	#analyser: AnalyserNode | undefined;
	#samples = new Float32Array(2048);
	#bins = new Float32Array(1024);
	#sourceStatus: EmbedAnalysisStatus = 'awaiting-playback';
	#corsLoading = false;
	#revision = 0;
	#closed = false;
	#resuming = false;
	constructor(readonly requested: boolean) {
		this.supported = typeof AudioContext !== 'undefined' && !!navigator.userActivation && 'captureStream' in HTMLMediaElement.prototype && typeof HTMLMediaElement.prototype.captureStream === 'function'
			&& /(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent)
			&& !/Android|Mobile|iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.maxTouchPoints === 0;
		document.addEventListener('visibilitychange', this.#visibility);
	}
	get available() { return this.requested && this.supported; }
	get corsLoading() { return this.#corsLoading; }
	get status(): EmbedAnalysisStatus {
		if (!this.requested) return 'disabled';
		if (!this.supported) return 'unsupported-browser';
		if (!this.#subscribed) return 'unsubscribed';
		if (document.visibilityState !== 'visible') return 'background';
		if (this.#sourceStatus !== 'available') return this.#sourceStatus;
		if (!this.#audio || this.#audio.ended || this.#audio.paused) return 'paused';
		if (this.#audio.seeking || this.#audio.readyState < 3) return 'buffering';
		if (!this.#context || this.#context.state !== 'running') return 'gesture-required';
		if (this.#stream && !this.#stream.getAudioTracks().some(track => track.readyState === 'live' && !track.muted && track.enabled)) return 'capture-unavailable';
		return 'available';
	}
	subscribe(value: boolean) {
		this.#subscribed = value;
		if (value) this.activate();
		else this.#suspend();
	}
	activate() {
		if (this.#closed || !this.available || !this.#subscribed || document.visibilityState !== 'visible' || !navigator.userActivation.hasBeenActive) return;
		try {
			this.#context ??= new AudioContext();
			if (this.#context.state === 'suspended' && !this.#resuming) {
				this.#resuming = true;
				void this.#context.resume().catch(() => {}).finally(() => { this.#resuming = false; });
			}
		} catch { this.#sourceStatus = 'capture-unavailable'; }
	}
	#visibility = () => {
		if (document.visibilityState !== 'visible') this.#suspend();
		else this.activate();
	};
	#suspend() {
		this.#disconnect();
		if (this.#context?.state === 'running') void this.#context.suspend().catch(() => {});
	}
	#disconnect() {
		this.#source?.disconnect();
		this.#analyser?.disconnect();
		this.#stream?.getTracks().forEach(track => track.stop());
		this.#source = undefined;
		this.#analyser = undefined;
		this.#stream = undefined;
	}
	reset() {
		this.#revision++;
		this.#corsLoading = false;
		this.#disconnect();
		this.#sourceStatus = 'awaiting-playback';
	}
	async load(audio: HTMLAudioElement, url: string, signal: AbortSignal) {
		this.#audio = audio;
		if (!this.available) { audio.removeAttribute('crossorigin'); audio.src = url; return; }
		const revision = this.#revision;
		this.#sourceStatus = 'awaiting-playback';
		this.#corsLoading = true;
		audio.crossOrigin = 'anonymous';
		try {
			await new Promise<void>((resolve, reject) => {
				const events = new AbortController();
				const finish = (error?: Error) => {
					clearTimeout(timeout); events.abort();
					if (error) reject(error); else resolve();
				};
				const timeout = setTimeout(() => finish(new Error('CORS media load timed out')), 3000);
				audio.addEventListener('loadedmetadata', () => finish(), { signal: events.signal });
				audio.addEventListener('error', () => finish(new Error('CORS media unavailable')), { signal: events.signal });
				signal.addEventListener('abort', () => finish(new Error('audio replaced')), { signal: events.signal });
				if (signal.aborted) finish(new Error('audio replaced'));
				else audio.src = url;
			});
			signal.throwIfAborted();
			if (revision === this.#revision) this.#sourceStatus = 'available';
		} catch (error) {
			if (signal.aborted || revision !== this.#revision) throw error;
			this.#sourceStatus = 'cors-unavailable';
			audio.removeAttribute('crossorigin');
			audio.src = url;
		} finally {
			if (revision === this.#revision) this.#corsLoading = false;
		}
	}
	read(): EmbedEvent['analysis'] {
		if (this.status !== 'available' || !this.#audio || !this.#context || !canCapture(this.#audio)) return null;
		try {
			if (!this.#analyser) {
				this.#stream = this.#audio.captureStream();
				const tracks = this.#stream.getAudioTracks();
				if (!tracks.length) { this.#sourceStatus = 'capture-unavailable'; this.#disconnect(); return null; }
				this.#source = this.#context.createMediaStreamSource(this.#stream);
				this.#analyser = this.#context.createAnalyser();
				this.#analyser.fftSize = 2048;
				this.#analyser.smoothingTimeConstant = 0;
				this.#source.connect(this.#analyser);
			}
			if (!this.#stream?.getAudioTracks().some(track => track.readyState === 'live' && !track.muted && track.enabled)) return null;
			this.#analyser.getFloatTimeDomainData(this.#samples);
			this.#analyser.getFloatFrequencyData(this.#bins);
			const sampleRate = this.#context.sampleRate;
			return {
				source: 'live', rms: Math.sqrt(this.#samples.reduce((sum, value) => sum + value * value, 0) / this.#samples.length),
				bands: [[60, 250], [250, 2000], [2000, 7500]].map(([low, high]) => this.#bins.reduce((sum, db, i) => {
					const hz = i * sampleRate / 2048;
					return sum + (hz >= low && hz < high ? Math.pow(10, db / 10) : 0);
				}, 0)),
				sampleRate, windowSamples: 2048
			};
		} catch { this.#sourceStatus = 'capture-unavailable'; this.#disconnect(); return null; }
	}
	close() {
		this.#closed = true;
		this.reset();
		document.removeEventListener('visibilitychange', this.#visibility);
		if (this.#context) void this.#context.close().catch(() => {});
	}
}
