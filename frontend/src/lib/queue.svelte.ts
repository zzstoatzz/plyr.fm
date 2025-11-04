import { browser } from '$app/environment';
import type { QueueResponse, QueueState, RepeatMode, Track } from './types';
import { API_URL } from './config';

const SYNC_DEBOUNCE_MS = 250;

// global queue state using Svelte 5 runes
class Queue {
	tracks = $state<Track[]>([]);
	currentIndex = $state(0);
	shuffle = $state(false);
	repeatMode = $state<RepeatMode>('none');
	originalOrder = $state<Track[]>([]);
	autoAdvance = $state(true);

	revision = $state<number | null>(null);
	etag = $state<string | null>(null);
	syncInProgress = $state(false);

	initialized = false;
	hydrating = false;

	syncTimer: number | null = null;
	pendingSync = false;

	get currentTrack(): Track | null {
		if (this.tracks.length === 0) return null;
		return this.tracks[this.currentIndex] ?? null;
	}

	get hasNext(): boolean {
		if (this.repeatMode === 'one') return true;
		if (this.repeatMode === 'all' && this.tracks.length > 0) return true;
		return this.currentIndex < this.tracks.length - 1;
	}

	get hasPrevious(): boolean {
		if (this.repeatMode === 'one') return true;
		if (this.repeatMode === 'all' && this.tracks.length > 0) return true;
		return this.currentIndex > 0;
	}

	get upNext(): Track[] {
		if (this.tracks.length === 0) return [];
		return this.tracks.slice(this.currentIndex + 1);
	}

	get upNextEntries(): { track: Track; index: number }[] {
		if (this.tracks.length === 0) return [];
		return this.tracks
			.map((track, index) => ({ track, index }))
			.filter(({ index }) => index > this.currentIndex);
	}

	getCurrentTrack(): Track | null {
		if (this.tracks.length === 0) return null;
		return this.tracks[this.currentIndex] ?? null;
	}

	getUpNextEntries(): { track: Track; index: number }[] {
		if (this.tracks.length === 0) return [];
		return this.tracks
			.map((track, index) => ({ track, index }))
			.filter(({ index }) => index > this.currentIndex);
	}

	setAutoAdvance(value: boolean) {
		this.autoAdvance = value;
		if (browser) {
			localStorage.setItem('autoAdvance', value ? '1' : '0');
		}
	}

	async initialize() {
		if (!browser || this.initialized) return;
		this.initialized = true;

		const savedAutoAdvance = localStorage.getItem('autoAdvance');
		if (savedAutoAdvance !== null) {
			this.autoAdvance = savedAutoAdvance !== '0';
		}

		await this.fetchQueue();

		document.addEventListener('visibilitychange', this.handleVisibilityChange);
		window.addEventListener('beforeunload', this.handleBeforeUnload);
	}

	handleVisibilityChange = () => {
		if (document.visibilityState === 'hidden') {
			void this.flushSync();
		}
	};

	handleBeforeUnload = () => {
		void this.flushSync();
	};

	async flushSync() {
		if (this.syncTimer) {
			window.clearTimeout(this.syncTimer);
			this.syncTimer = null;
			await this.pushQueue();
			return;
		}

		if (this.pendingSync && !this.syncInProgress) {
			await this.pushQueue();
		}
	}

	async fetchQueue(force = false) {
		if (!browser) return;

		// while we have unsent or in-flight local changes, skip non-forced fetches
		if (
			!force &&
			(this.syncInProgress || this.syncTimer !== null || this.pendingSync)
		) {
			return;
		}

		try {
			this.hydrating = true;

			const sessionId = localStorage.getItem('session_id');
			const headers: HeadersInit = {};

			if (sessionId) {
				headers['Authorization'] = `Bearer ${sessionId}`;
			}

			if (this.etag && !force) {
				headers['If-None-Match'] = this.etag;
			}

			const response = await fetch(`${API_URL}/queue/`, { headers });

			if (response.status === 304) {
				return;
			}

			if (!response.ok) {
				throw new Error(`failed to fetch queue: ${response.statusText}`);
			}

			const data: QueueResponse = await response.json();
			const newEtag = response.headers.get('etag');

			if (this.revision !== null && data.revision < this.revision) {
				return;
			}

			this.revision = data.revision;
			this.etag = newEtag;

			this.applySnapshot(data);
		} catch (error) {
			console.error('failed to fetch queue:', error);
		} finally {
			this.hydrating = false;
		}
	}

	applySnapshot(snapshot: QueueResponse) {
		const { state, tracks } = snapshot;
		const trackIds = state.track_ids ?? [];
		const serverTracks = tracks ?? [];
		const previousTracks = [...this.tracks];

		const orderedTracks: Track[] = [];
		for (let i = 0; i < trackIds.length; i++) {
			const fileId = trackIds[i];
			const serverTrack = serverTracks[i];
			const existingTrack = previousTracks[i];
			const fallbackTrack = previousTracks.find((track) => track.file_id === fileId);
			const next = serverTrack ?? existingTrack ?? fallbackTrack;

			if (next) {
				orderedTracks.push(next);
			}
		}

		if (orderedTracks.length > 0 || trackIds.length === 0) {
			this.tracks = orderedTracks;
		}

		const originalIds =
			state.original_order_ids && state.original_order_ids.length > 0
				? state.original_order_ids
				: trackIds;

		const pools = new Map<string, Track[]>();
		for (const track of orderedTracks) {
			const list = pools.get(track.file_id) ?? [];
			list.push(track);
			pools.set(track.file_id, list);
		}

		const originalTracks: Track[] = [];
		for (const fileId of originalIds) {
			const pool = pools.get(fileId);
			if (pool && pool.length > 0) {
				originalTracks.push(pool.shift()!);
				continue;
			}

			const fallback = orderedTracks.find((track) => track.file_id === fileId);
			if (fallback) {
				originalTracks.push(fallback);
			}
		}

		if (originalTracks.length > 0 || originalIds.length === 0) {
			this.originalOrder = originalTracks.length ? originalTracks : [...orderedTracks];
		}

		this.shuffle = state.shuffle;
		this.repeatMode = state.repeat_mode;

		this.currentIndex = this.resolveCurrentIndex(
			state.current_track_id,
			state.current_index,
			this.tracks
		);
	}

	resolveCurrentIndex(currentTrackId: string | null, index: number, tracks: Track[]): number {
		if (tracks.length === 0) return 0;

		const indexInRange = Number.isInteger(index) && index >= 0 && index < tracks.length;

		// trust the explicit index first – the server always sends the correct slot
		if (indexInRange) {
			return index;
		}

		if (currentTrackId) {
			const match = tracks.findIndex((track) => track.file_id === currentTrackId);
			if (match !== -1) return match;
		}

		return 0;
	}

	clampIndex(index: number): number {
		if (this.tracks.length === 0) return 0;
		if (index < 0) return 0;
		if (index >= this.tracks.length) return this.tracks.length - 1;
		return index;
	}

	schedulePush() {
		if (!browser) return;

		if (this.syncTimer !== null) {
			window.clearTimeout(this.syncTimer);
		}

		this.syncTimer = window.setTimeout(() => {
			this.syncTimer = null;
			void this.pushQueue();
		}, SYNC_DEBOUNCE_MS);
	}

	async pushQueue(): Promise<boolean> {
		if (!browser) return false;

		if (this.syncInProgress) {
			this.pendingSync = true;
			return false;
		}

		if (this.syncTimer !== null) {
			window.clearTimeout(this.syncTimer);
			this.syncTimer = null;
		}

		this.syncInProgress = true;
		this.pendingSync = false;

		try {
			const sessionId = localStorage.getItem('session_id');
			const state: QueueState = {
				track_ids: this.tracks.map((t) => t.file_id),
				current_index: this.currentIndex,
				current_track_id: this.currentTrack?.file_id ?? null,
				shuffle: this.shuffle,
				repeat_mode: this.repeatMode,
				original_order_ids: this.originalOrder.map((t) => t.file_id)
			};

			const headers: HeadersInit = {
				'Content-Type': 'application/json'
			};

			if (sessionId) {
				headers['Authorization'] = `Bearer ${sessionId}`;
			}

			if (this.revision !== null) {
				headers['If-Match'] = `"${this.revision}"`;
			}

			const response = await fetch(`${API_URL}/queue/`, {
				method: 'PUT',
				headers,
				body: JSON.stringify({ state })
			});

			if (response.status === 409) {
				console.warn('queue conflict detected, fetching latest state');
				await this.fetchQueue(true);
				return false;
			}

			if (!response.ok) {
				throw new Error(`failed to push queue: ${response.statusText}`);
			}

			const data: QueueResponse = await response.json();
			const newEtag = response.headers.get('etag');

			if (this.revision !== null && data.revision < this.revision) {
				return true;
			}

			this.revision = data.revision;
			this.etag = newEtag;

			this.applySnapshot(data);

			return true;
		} catch (error) {
			console.error('failed to push queue:', error);
			return false;
		} finally {
			this.syncInProgress = false;

			if (this.pendingSync) {
				this.pendingSync = false;
				void this.pushQueue();
			}
		}
	}

	addTracks(tracks: Track[], playNow = false) {
		if (tracks.length === 0) return;

		this.tracks = [...this.tracks, ...tracks];
		this.originalOrder = [...this.originalOrder, ...tracks];

		if (playNow) {
			this.currentIndex = this.tracks.length - tracks.length;
		}

		this.schedulePush();
	}

	setQueue(tracks: Track[], startIndex = 0) {
		if (tracks.length === 0) {
			this.clear();
			return;
		}

		this.tracks = [...tracks];
		this.originalOrder = [...tracks];
		this.currentIndex = this.clampIndex(startIndex);
		this.schedulePush();
	}

	playNow(track: Track) {
		const upNext = this.tracks.slice(this.currentIndex + 1);
		this.tracks = [track, ...upNext];
		this.originalOrder = [...this.tracks];
		this.currentIndex = 0;
		this.schedulePush();
	}

	clear() {
		this.tracks = [];
		this.originalOrder = [];
		this.currentIndex = 0;
		this.schedulePush();
	}

	goTo(index: number) {
		if (index < 0 || index >= this.tracks.length) return;
		this.currentIndex = index;
		this.schedulePush();
	}

	next() {
		if (!this.hasNext) return;

		if (this.repeatMode === 'one') {
			return;
		}

		if (this.currentIndex < this.tracks.length - 1) {
			this.currentIndex += 1;
		} else if (this.repeatMode === 'all') {
			this.currentIndex = 0;
		}

		this.schedulePush();
	}

	previous() {
		if (!this.hasPrevious) return;

		if (this.repeatMode === 'one') {
			return;
		}

		if (this.currentIndex > 0) {
			this.currentIndex -= 1;
		} else if (this.repeatMode === 'all') {
			this.currentIndex = this.tracks.length - 1;
		}

		this.schedulePush();
	}

	toggleShuffle() {
		if (this.tracks.length <= 1) {
			this.shuffle = false;
			return;
		}

		const current = this.currentTrack;

		if (!this.shuffle) {
			this.originalOrder = [...this.tracks];
			const shuffled = [...this.tracks];

			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
			}

			this.tracks = shuffled;
			this.shuffle = true;
		} else {
			this.tracks = [...this.originalOrder];
			this.shuffle = false;
		}

		if (current) {
			const newIndex = this.tracks.findIndex((track) => track.file_id === current.file_id);
			this.currentIndex = newIndex === -1 ? this.clampIndex(this.currentIndex) : newIndex;
		} else {
			this.currentIndex = this.clampIndex(this.currentIndex);
		}

		this.schedulePush();
	}

	cycleRepeat() {
		if (this.repeatMode === 'none') {
			this.repeatMode = 'all';
		} else if (this.repeatMode === 'all') {
			this.repeatMode = 'one';
		} else {
			this.repeatMode = 'none';
		}

		this.schedulePush();
	}

	moveTrack(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		if (fromIndex < 0 || fromIndex >= this.tracks.length) return;
		if (toIndex < 0 || toIndex >= this.tracks.length) return;

		const updated = [...this.tracks];
		const [moved] = updated.splice(fromIndex, 1);
		updated.splice(toIndex, 0, moved);

		if (fromIndex === this.currentIndex) {
			this.currentIndex = toIndex;
		} else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
			this.currentIndex -= 1;
		} else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
			this.currentIndex += 1;
		}

		this.tracks = updated;

		if (!this.shuffle) {
			this.originalOrder = [...updated];
		}

		this.schedulePush();
	}

	removeTrack(index: number) {
		if (index < 0 || index >= this.tracks.length) return;
		if (index === this.currentIndex) return;

		const updated = [...this.tracks];
		const [removed] = updated.splice(index, 1);

		this.tracks = updated;
		this.originalOrder = this.originalOrder.filter((track) => track.file_id !== removed.file_id);

		if (updated.length === 0) {
			this.currentIndex = 0;
			this.schedulePush();
			return;
		}

		if (index < this.currentIndex) {
			this.currentIndex -= 1;
		} else if (index === this.currentIndex) {
			this.currentIndex = this.clampIndex(this.currentIndex);
		}

		this.schedulePush();
	}
}

export const queue = new Queue();

if (browser) {
	void queue.initialize();
}
