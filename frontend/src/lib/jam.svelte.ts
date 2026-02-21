import { browser } from '$app/environment';
import { API_URL } from './config';
import { queue, type JamBridge } from './queue.svelte';
import type { JamInfo, JamParticipant, JamPlaybackState, Track } from './types';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

class JamState {
	active = $state(false);
	jam = $state<JamInfo | null>(null);
	participants = $state<JamParticipant[]>([]);
	tracks = $state<Track[]>([]);
	currentIndex = $state(0);
	isPlaying = $state(false);
	progressMs = $state(0);
	serverTimeMs = $state(0);
	revision = $state(0);
	connected = $state(false);
	reconnecting = $state(false);

	private ws: WebSocket | null = null;
	private lastStreamId: string | null = null;
	private reconnectTimer: number | null = null;
	private reconnectDelay = RECONNECT_BASE_MS;
	private visibilityHandler: (() => void) | null = null;
	private currentCode: string | null = null;

	get currentTrack(): Track | null {
		if (this.tracks.length === 0) return null;
		return this.tracks[this.currentIndex] ?? null;
	}

	get interpolatedProgressMs(): number {
		if (!this.isPlaying) return this.progressMs;
		return this.progressMs + (Date.now() - this.serverTimeMs);
	}

	get code(): string | null {
		return this.jam?.code ?? null;
	}

	private createBridge(): JamBridge {
		return {
			playTrack: (fileId) => this.sendCommand({ type: 'play_track', file_id: fileId }),
			addTracks: (fileIds) => this.sendCommand({ type: 'add_tracks', track_ids: fileIds }),
			removeTrack: (index) => this.sendCommand({ type: 'remove_track', index }),
			setIndex: (index) => this.sendCommand({ type: 'set_index', index }),
			next: () => this.sendCommand({ type: 'next' }),
			previous: () => this.sendCommand({ type: 'previous' }),
			play: () => this.sendCommand({ type: 'play' }),
			pause: () => this.sendCommand({ type: 'pause' }),
			seek: (ms) => this.sendCommand({ type: 'seek', position_ms: ms }),
		};
	}

	// ── lifecycle ─────────────────────────────────────────────────

	async create(
		name?: string,
		trackIds?: string[],
		currentIndex?: number,
		isPlaying?: boolean,
		progressMs?: number
	): Promise<string | null> {
		if (!browser) return null;

		try {
			const response = await fetch(`${API_URL}/jams/`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name ?? null,
					track_ids: trackIds ?? [],
					current_index: currentIndex ?? 0,
					is_playing: isPlaying ?? false,
					progress_ms: progressMs ?? 0
				})
			});

			if (!response.ok) return null;

			const data: JamInfo = await response.json();
			this.applyJamData(data);
			this.connect(data.code);
			queue.stopPositionSave();
			queue.setJamBridge(this.createBridge());
			return data.code;
		} catch (error) {
			console.error('failed to create jam:', error);
			return null;
		}
	}

	async join(code: string): Promise<boolean> {
		if (!browser) return false;

		try {
			const response = await fetch(`${API_URL}/jams/${code}/join`, {
				method: 'POST',
				credentials: 'include'
			});

			if (!response.ok) return false;

			const data: JamInfo = await response.json();
			this.applyJamData(data);
			this.connect(code);
			queue.stopPositionSave();
			queue.setJamBridge(this.createBridge());
			return true;
		} catch (error) {
			console.error('failed to join jam:', error);
			return false;
		}
	}

	async leave(): Promise<void> {
		if (!browser || !this.jam) return;

		const code = this.jam.code;
		try {
			await fetch(`${API_URL}/jams/${code}/leave`, {
				method: 'POST',
				credentials: 'include'
			});
		} catch (error) {
			console.error('failed to leave jam:', error);
		}

		this.closeWs();
		this.reset();
		queue.setJamBridge(null);
		queue.startPositionSave();
		queue.fetchQueue();
	}

	async fetchJam(code: string): Promise<JamInfo | null> {
		if (!browser) return null;

		try {
			const response = await fetch(`${API_URL}/jams/${code}`, {
				credentials: 'include'
			});
			if (!response.ok) return null;
			return await response.json();
		} catch (error) {
			console.error('failed to fetch jam:', error);
			return null;
		}
	}

	async fetchActive(): Promise<JamInfo | null> {
		if (!browser) return null;

		try {
			const response = await fetch(`${API_URL}/jams/active`, {
				credentials: 'include'
			});
			if (!response.ok) return null;
			const data = await response.json();
			return data ?? null;
		} catch {
			return null;
		}
	}

	// ── commands (via WebSocket) ───────────────────────────────────

	play(): void {
		this.sendCommand({ type: 'play' });
	}

	pause(): void {
		this.sendCommand({ type: 'pause' });
	}

	seek(ms: number): void {
		this.sendCommand({ type: 'seek', position_ms: ms });
	}

	next(): void {
		this.sendCommand({ type: 'next' });
	}

	previous(): void {
		this.sendCommand({ type: 'previous' });
	}

	addTracks(ids: string[]): void {
		this.sendCommand({ type: 'add_tracks', track_ids: ids });
	}

	removeTrack(index: number): void {
		this.sendCommand({ type: 'remove_track', index });
	}

	playTrack(fileId: string): void {
		this.sendCommand({ type: 'play_track', file_id: fileId });
	}

	setIndex(index: number): void {
		this.sendCommand({ type: 'set_index', index });
	}

	private sendCommand(payload: Record<string, unknown>): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		this.ws.send(JSON.stringify({ type: 'command', payload }));
	}

	// ── WebSocket lifecycle ────────────────────────────────────────

	private connect(code: string): void {
		this.closeWs();
		this.currentCode = code;

		const wsProtocol = API_URL.startsWith('https') ? 'wss' : 'ws';
		const wsBase = API_URL.replace(/^https?/, wsProtocol);
		const url = `${wsBase}/jams/${code}/ws`;

		this.ws = new WebSocket(url);
		this.reconnecting = false;

		// reconnect when app resumes from background
		this.visibilityHandler = () => {
			if (document.visibilityState === 'visible' && this.active && !this.connected) {
				this.connect(code);
			}
		};
		document.addEventListener('visibilitychange', this.visibilityHandler);

		this.ws.onopen = () => {
			this.connected = true;
			this.reconnectDelay = RECONNECT_BASE_MS;
			// request sync
			this.ws?.send(
				JSON.stringify({ type: 'sync', last_id: this.lastStreamId })
			);
		};

		this.ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				this.handleMessage(data);
			} catch (error) {
				console.error('failed to parse jam ws message:', error);
			}
		};

		this.ws.onclose = () => {
			this.connected = false;
			if (this.active) {
				this.scheduleReconnect(code);
			}
		};

		this.ws.onerror = () => {
			// onclose will fire after onerror
		};
	}

	private scheduleReconnect(code: string): void {
		if (this.reconnectTimer !== null) return;
		this.reconnecting = true;

		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			if (this.active) {
				this.connect(code);
			}
		}, this.reconnectDelay);

		this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
	}

	private closeWs(): void {
		if (this.visibilityHandler) {
			document.removeEventListener('visibilitychange', this.visibilityHandler);
			this.visibilityHandler = null;
		}
		if (this.reconnectTimer !== null) {
			window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.onerror = null;
			this.ws.onmessage = null;
			this.ws.onopen = null;
			this.ws.close();
			this.ws = null;
		}
		this.connected = false;
		this.reconnecting = false;
	}

	// ── message handling ───────────────────────────────────────────

	private handleMessage(data: Record<string, unknown>): void {
		const msgType = data.type as string;

		if (msgType === 'state') {
			this.handleStateMessage(data);
		} else if (msgType === 'participant') {
			this.handleParticipantMessage(data);
		} else if (msgType === 'pong') {
			// heartbeat response, no-op
		} else if (msgType === 'error') {
			console.error('jam error:', data.message);
		}
	}

	private handleStateMessage(data: Record<string, unknown>): void {
		const state = data.state as JamPlaybackState;
		const rev = data.revision as number;
		const streamId = data.stream_id as string | null;

		if (rev < this.revision) return;

		this.revision = rev;
		if (streamId) this.lastStreamId = streamId;

		this.currentIndex = state.current_index;
		this.isPlaying = state.is_playing;
		this.progressMs = state.progress_ms;
		this.serverTimeMs = state.server_time_ms;

		if (data.tracks_changed && Array.isArray(data.tracks)) {
			this.tracks = data.tracks as Track[];
		}

		if (Array.isArray(data.participants)) {
			this.participants = data.participants as JamParticipant[];
		}

		this.syncToQueue();
	}

	private handleParticipantMessage(_data: Record<string, unknown>): void {
		// re-fetch participants from next state message
		// for now just log it — the sync messages include participants
	}

	// ── state management ───────────────────────────────────────────

	private applyJamData(data: JamInfo): void {
		this.jam = data;
		this.active = true;
		this.tracks = data.tracks ?? [];
		this.participants = data.participants ?? [];
		this.revision = data.revision;

		const state = data.state;
		this.currentIndex = state.current_index;
		this.isPlaying = state.is_playing;
		this.progressMs = state.progress_ms;
		this.serverTimeMs = state.server_time_ms;

		this.syncToQueue();
	}

	/** push jam tracks/index into queue so read-path getters (hasNext, hasPrevious, etc.) work */
	private syncToQueue(): void {
		queue.tracks = this.tracks;
		queue.currentIndex = this.currentIndex;
	}

	private reset(): void {
		this.active = false;
		this.jam = null;
		this.participants = [];
		this.tracks = [];
		this.currentIndex = 0;
		this.isPlaying = false;
		this.progressMs = 0;
		this.serverTimeMs = 0;
		this.revision = 0;
		this.lastStreamId = null;
	}

	destroy(): void {
		this.closeWs();
		this.reset();
		queue.setJamBridge(null);
		queue.startPositionSave();
		queue.fetchQueue();
	}
}

export const jam = new JamState();
