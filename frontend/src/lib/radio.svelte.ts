// radio data + control. this does NOT own an audio element or a player — it
// fetches the shared station state and drives the global player's radio source
// (player.playRadio / player.stopRadio). "active" is read from the player, the
// single source of truth.
import { API_URL } from './config';
import { player, type RadioNowPlaying } from './player.svelte';
import type { Track } from './types';

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
	state = $state<RadioState | null>(null);
	loading = $state(true);
	error = $state<string | null>(null);
	private pollTimer: number | null = null;

	get current(): RadioTrack | null {
		return this.state?.current ?? null;
	}

	/** whether radio is the active player source (single source of truth) */
	get active(): boolean {
		return player.radio !== null;
	}

	/** how far into the current track (seconds): live position when tuned in,
	 * else the shared station position. */
	get positionSeconds(): number {
		if (player.radio && Number.isFinite(player.currentTime)) return player.currentTime;
		return this.state ? this.stateProgress(this.state) : 0;
	}

	private stateProgress(fetched: RadioState): number {
		const generatedAt = Date.parse(fetched.generated_at);
		const drift = Number.isFinite(generatedAt) ? Math.max(0, (Date.now() - generatedAt) / 1000) : 0;
		return Math.min(fetched.current?.duration ?? 0, fetched.progress_seconds + drift);
	}

	private toNowPlaying(c: RadioTrack): RadioNowPlaying {
		// the on-air entry is a real track — reshape it as a Track so the normal
		// player strip renders it identically to any other track.
		const track: Track = {
			id: c.id,
			title: c.title,
			artist: c.artist,
			artist_handle: c.artist_handle,
			artist_did: c.artist_did,
			file_id: '',
			file_type: c.file_type,
			play_count: c.play_count,
			like_count: c.like_count,
			image_url: c.artwork_url ?? undefined,
			thumbnail_url: c.thumbnail_url ?? undefined,
			created_at: c.created_at,
			tags: c.tags,
			atproto_record_uri: c.atproto_record_uri ?? undefined,
			album: null,
			features: []
		};
		return {
			track,
			stream_url: c.stream_url,
			start_at: this.state ? this.stateProgress(this.state) : 0
		};
	}

	async loadState(): Promise<void> {
		try {
			const response = await fetch(`${API_URL}/radio/state`);
			if (!response.ok) throw new Error(`radio returned ${response.status}`);
			this.state = await response.json();
			this.error = null;
		} catch (e) {
			console.error('failed to load radio state:', e);
			this.error = 'radio is off air right now';
		} finally {
			this.loading = false;
		}
	}

	/** start radio. synchronous (no await) so the caller's gesture is preserved
	 * for autoplay — call once `current` is loaded (the page gates on it). */
	tuneIn(): void {
		const c = this.current;
		if (!c) return;
		player.playRadio(this.toNowPlaying(c));
		this.startPolling();
	}

	stop(): void {
		player.stopRadio();
		this.stopPolling();
	}

	/** the current stream ended — pull the station's now-current track */
	async onEnded(): Promise<void> {
		await this.loadState();
		const c = this.current;
		if (c && player.radio) player.playRadio(this.toNowPlaying(c));
	}

	/** poll: follow the shared station when it rotates to a new track */
	private async syncToStation(): Promise<void> {
		// radio was turned off elsewhere (playing a track nulls player.radio
		// without calling stop()) — tear the poll down so it doesn't leak.
		if (!player.radio) {
			this.stopPolling();
			return;
		}
		await this.loadState();
		const c = this.current;
		if (!c || !player.radio) return;
		if (player.radio.stream_url !== c.stream_url) {
			player.playRadio(this.toNowPlaying(c), { autoplay: !player.paused });
		}
	}

	private startPolling(): void {
		this.stopPolling();
		this.pollTimer = window.setInterval(() => this.syncToStation(), POLL_INTERVAL_MS);
	}

	private stopPolling(): void {
		if (this.pollTimer) {
			window.clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}
}

export const radio = new Radio();
