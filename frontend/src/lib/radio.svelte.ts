// global radio playback state. radio is a distinct playback mode — it drives a
// persistent <audio> element (mounted in Player.svelte, so it survives route
// navigation) and is rendered in the footer player. it deliberately does NOT
// touch the queue: tuning in just takes over audio output until you stop it or
// start a queue track.
import { API_URL } from './config';
import { player } from './player.svelte';

export interface RadioTrack {
	id: number;
	title: string;
	artist: string;
	artist_handle: string;
	artist_did: string;
	stream_url: string;
	file_type: string;
	duration: number;
	artwork_url: string | null;
	thumbnail_url: string | null;
	atproto_record_uri: string | null;
	created_at: string;
	tags: string[];
	like_count: number;
	play_count: number;
}

export interface RadioState {
	station: string;
	generated_at: string;
	loop_duration_seconds: number;
	current_index: number | null;
	current_started_at: string | null;
	current_ends_at: string | null;
	progress_seconds: number;
	current: RadioTrack | null;
	up_next: RadioTrack[];
	rotation: RadioTrack[];
}

const POLL_INTERVAL_MS = 30000;

class Radio {
	audioElement = $state<HTMLAudioElement | undefined>(undefined);
	state = $state<RadioState | null>(null);
	/** radio mode engaged (user tuned in) — drives the footer player display */
	active = $state(false);
	playing = $state(false);
	loading = $state(true);
	error = $state<string | null>(null);
	progressSeconds = $state(0);
	private pollTimer: number | null = null;

	get current(): RadioTrack | null {
		return this.state?.current ?? null;
	}

	get duration(): number {
		return this.current?.duration ?? 0;
	}

	private stateProgress(fetched: RadioState): number {
		const generatedAt = Date.parse(fetched.generated_at);
		const drift = Number.isFinite(generatedAt) ? Math.max(0, (Date.now() - generatedAt) / 1000) : 0;
		return Math.min(fetched.current?.duration ?? 0, fetched.progress_seconds + drift);
	}

	private syncAudioToState(fetched: RadioState) {
		const el = this.audioElement;
		if (!el || !fetched.current) return;

		const targetProgress = this.stateProgress(fetched);
		const sourceChanged = el.src !== fetched.current.stream_url;
		if (sourceChanged) {
			el.src = fetched.current.stream_url;
			el.load();
		}

		const seek = () => {
			if (!el || !fetched.current) return;
			if (Number.isFinite(targetProgress)) {
				el.currentTime = Math.min(targetProgress, fetched.current.duration);
				this.progressSeconds = el.currentTime;
			}
			if (this.playing) el.play().catch(() => (this.playing = false));
		};

		if (el.readyState >= HTMLMediaElement.HAVE_METADATA && !sourceChanged) {
			if (Math.abs(el.currentTime - targetProgress) > 5) seek();
		} else {
			el.onloadedmetadata = seek;
		}
	}

	/** fetch station state for display; only re-syncs the audio when tuned in */
	async loadState(syncAudio = false): Promise<void> {
		try {
			const response = await fetch(`${API_URL}/radio/state`);
			if (!response.ok) throw new Error(`radio returned ${response.status}`);
			const next: RadioState = await response.json();
			this.state = next;
			this.progressSeconds = this.stateProgress(next);
			this.error = null;
			if (syncAudio) this.syncAudioToState(next);
		} catch (e) {
			console.error('failed to load radio state:', e);
			this.error = 'radio is off air right now';
		} finally {
			this.loading = false;
		}
	}

	/** user-gesture entry point — starts radio playback through the footer player */
	async tuneIn(): Promise<void> {
		this.active = true;
		// radio and queue share audio output; stop any queue track
		player.paused = true;
		this.playing = true;
		if (!this.state) await this.loadState(false);
		if (!this.state?.current) {
			this.playing = false;
			return;
		}
		this.syncAudioToState(this.state);
		try {
			await this.audioElement?.play();
			this.playing = true;
		} catch (e) {
			console.error('failed to play radio:', e);
			this.playing = false;
		}
		this.startPolling();
	}

	togglePlayPause(): void {
		if (!this.audioElement) return;
		if (this.playing) {
			this.audioElement.pause();
		} else {
			player.paused = true;
			this.audioElement.play().catch(() => (this.playing = false));
		}
	}

	stop(): void {
		this.audioElement?.pause();
		this.active = false;
		this.playing = false;
		this.stopPolling();
	}

	onEnded(): void {
		// current track in rotation finished — pull the next one
		this.loadState(true);
	}

	private startPolling(): void {
		this.stopPolling();
		this.pollTimer = window.setInterval(() => {
			this.loadState(this.playing);
		}, POLL_INTERVAL_MS);
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			window.clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}
}

export const radio = new Radio();
