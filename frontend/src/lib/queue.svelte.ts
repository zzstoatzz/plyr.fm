import { browser } from '$app/environment';
import type { QueueResponse, QueueState, Track } from './types';
import { API_URL } from './config';
import { APP_BROADCAST_PREFIX } from './branding';

const SYNC_DEBOUNCE_MS = 250;

// global queue state using Svelte 5 runes
class Queue {
	tracks = $state<Track[]>([]);
	currentIndex = $state(0);
	shuffle = $state(false);
	originalOrder = $state<Track[]>([]);
	autoAdvance = $state(true);

	revision = $state<number | null>(null);
	etag = $state<string | null>(null);
	syncInProgress = $state(false);
	lastUpdateWasLocal = $state(false);

	initialized = false;
	hydrating = false;

	syncTimer: number | null = null;
	pendingSync = false;
	channel: BroadcastChannel | null = null;
	tabId: string | null = null;

	get currentTrack(): Track | null {
		if (this.tracks.length === 0) return null;
		return this.tracks[this.currentIndex] ?? null;
	}

	get hasNext(): boolean {
		return this.currentIndex < this.tracks.length - 1;
	}

	get hasPrevious(): boolean {
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

		const storedTabId = sessionStorage.getItem('queue_tab_id');
		if (storedTabId) {
			this.tabId = storedTabId;
		} else {
			this.tabId = this.createTabId();
			sessionStorage.setItem('queue_tab_id', this.tabId);
		}

		const savedAutoAdvance = localStorage.getItem('autoAdvance');
		if (savedAutoAdvance !== null) {
			this.autoAdvance = savedAutoAdvance !== '0';
		}

		// set up cross-tab synchronization
		this.channel = new BroadcastChannel(`${APP_BROADCAST_PREFIX}-queue`);
		this.channel.onmessage = (event) => {
			if (event.data.type === 'queue-updated') {
				// ignore our own broadcasts (we already have this revision)
				if (event.data.sourceTabId && event.data.sourceTabId === this.tabId) {
					return;
				}

				if (event.data.revision === this.revision) {
					return;
				}

				// another tab updated the queue, refetch to stay in sync
				this.lastUpdateWasLocal = false;
				void this.fetchQueue(true);
			}
		};

		// only fetch from server if authenticated
		if (this.isAuthenticated()) {
			await this.fetchQueue();
		}

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
		this.channel?.close();
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

	private isAuthenticated(): boolean {
		if (!browser) return false;
		return !!localStorage.getItem('session_id');
	}

	async fetchQueue(force = false) {
		if (!browser) return;
		if (!this.isAuthenticated()) return; // skip if not authenticated

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

		// build track lookup by file_id from server tracks (deduplicated)
		const trackByFileId = new Map<string, Track>();
		for (const track of serverTracks) {
			if (track) {
				trackByFileId.set(track.file_id, track);
			}
		}

		// build ordered tracks array, using track metadata for each file_id
		const orderedTracks: Track[] = [];
		for (const fileId of trackIds) {
			const track = trackByFileId.get(fileId);
			if (track) {
				// always use a copy to ensure each queue position is independent
				orderedTracks.push({ ...track });
			}
		}

		if (orderedTracks.length > 0 || trackIds.length === 0) {
			this.tracks = orderedTracks;
		}

		// build original order array
		const originalIds =
			state.original_order_ids && state.original_order_ids.length > 0
				? state.original_order_ids
				: trackIds;

		const originalTracks: Track[] = [];
		for (const fileId of originalIds) {
			const track = trackByFileId.get(fileId);
			if (track) {
				// always use a copy to ensure independence
				originalTracks.push({ ...track });
			}
		}

		if (originalTracks.length > 0 || originalIds.length === 0) {
			this.originalOrder = originalTracks.length ? originalTracks : [...orderedTracks];
		}

		this.shuffle = state.shuffle;

		// sync autoAdvance from server
		if (state.auto_advance !== undefined) {
			this.autoAdvance = state.auto_advance;
		}

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
		if (!this.isAuthenticated()) return false; // skip if not authenticated

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
				original_order_ids: this.originalOrder.map((t) => t.file_id),
				auto_advance: this.autoAdvance
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

			if (response.status === 401) {
				// session expired or invalid, clear it and stop trying to sync
				localStorage.removeItem('session_id');
				return false;
			}

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

			// notify other tabs about the queue update
			const sourceTabId = this.tabId ?? this.createTabId();
			this.tabId = sourceTabId;
			try {
				sessionStorage.setItem('queue_tab_id', sourceTabId);
			} catch (error) {
				console.warn('failed to persist queue tab id', error);
			}
			this.channel?.postMessage({ type: 'queue-updated', revision: data.revision, sourceTabId });

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

		this.lastUpdateWasLocal = true;
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

		this.lastUpdateWasLocal = true;
		this.tracks = [...tracks];
		this.originalOrder = [...tracks];
		this.currentIndex = this.clampIndex(startIndex);
		this.schedulePush();
	}

	playNow(track: Track) {
		this.lastUpdateWasLocal = true;
		const upNext = this.tracks.slice(this.currentIndex + 1);
		this.tracks = [track, ...upNext];
		this.originalOrder = [...this.tracks];
		this.currentIndex = 0;
		this.schedulePush();
	}

	clear() {
		this.lastUpdateWasLocal = true;
		this.tracks = [];
		this.originalOrder = [];
		this.currentIndex = 0;
		this.schedulePush();
	}

	goTo(index: number) {
		if (index < 0 || index >= this.tracks.length) return;
		this.lastUpdateWasLocal = true;
		this.currentIndex = index;
		this.schedulePush();
	}

	next() {
		if (this.tracks.length === 0) return;

		if (this.currentIndex < this.tracks.length - 1) {
			this.lastUpdateWasLocal = true;
			this.currentIndex += 1;
			this.schedulePush();
		}
	}

	previous(forceSkip = false) {
		if (this.tracks.length === 0) return;

		if (this.currentIndex > 0 || forceSkip) {
			this.lastUpdateWasLocal = true;
			if (this.currentIndex > 0) {
				this.currentIndex -= 1;
			}
			this.schedulePush();
			return true;
		}
		return false;
	}

	toggleShuffle() {
		// shuffle is an action, not a mode - shuffle upcoming tracks every time
		if (this.tracks.length <= 1) {
			return;
		}

		this.lastUpdateWasLocal = true;

		// keep current track, shuffle everything after it
		const current = this.tracks[this.currentIndex];
		const before = this.tracks.slice(0, this.currentIndex);
		const after = this.tracks.slice(this.currentIndex + 1);

		// if only one track in up next, nothing to shuffle
		if (after.length <= 1) {
			return;
		}

		// fisher-yates shuffle, ensuring we get a DIFFERENT permutation
		let shuffled: typeof after;
		let attempts = 0;
		const maxAttempts = 10;

		do {
			shuffled = [...after];
			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
			}
			attempts++;
		} while (
			attempts < maxAttempts &&
			shuffled.every((track, i) => track.file_id === after[i].file_id)
		);

		// rebuild queue: everything before current + current + shuffled upcoming
		this.tracks = [...before, current, ...shuffled];

		// current index stays the same (it's in the same position)
		// no need to update currentIndex

		this.schedulePush();
	}

	moveTrack(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		if (fromIndex < 0 || fromIndex >= this.tracks.length) return;
		if (toIndex < 0 || toIndex >= this.tracks.length) return;

		this.lastUpdateWasLocal = true;
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

		this.lastUpdateWasLocal = true;
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

	clearUpNext() {
		if (this.tracks.length === 0) return;

		this.lastUpdateWasLocal = true;

		// keep only the current track
		const currentTrack = this.tracks[this.currentIndex];
		if (!currentTrack) return;

		this.tracks = [currentTrack];
		this.originalOrder = [currentTrack];
		this.currentIndex = 0;

		this.schedulePush();
	}

	private createTabId(): string {
		if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
			return crypto.randomUUID();
		}

		return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}
}

export const queue = new Queue();

if (browser) {
	void queue.initialize();
}
