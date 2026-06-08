import { browser } from '$app/environment';
import type { QueueResponse, QueueState, RepeatMode, Track } from './types';
import { API_URL } from './config';
import { APP_BROADCAST_PREFIX } from './branding';
import { auth } from './auth.svelte';
import { player } from './player.svelte';
import { forYouCache } from './for-you.svelte';

const SYNC_DEBOUNCE_MS = 250;

// "keep playing": when the queue drains to this many upcoming tracks, top the
// tail up from the For You feed. tracks must be appended ahead of the current
// track ending so Player.svelte's synchronous prefetch path can resolve them.
export const CONTINUATION_LOW_WATER = 2;
const CONTINUATION_BATCH = 20;

/** bridge for routing queue mutations through a jam's WebSocket transport */
export interface JamBridge {
	pushQueueState(): void;
	play(): void;
	pause(): void;
	seek(ms: number): void;
}

// global queue state using Svelte 5 runes
class Queue {
	jamBridge = $state<JamBridge | null>(null);

	setJamBridge(bridge: JamBridge | null): void {
		this.jamBridge = bridge;
	}
	tracks = $state<Track[]>([]);
	currentIndex = $state(0);
	shuffle = $state(false);
	repeatMode = $state<RepeatMode>('none');
	originalOrder = $state<Track[]>([]);
	progressMs = $state(0);

	/**
	 * Index where the auto-generated continuation tail begins (rendered as
	 * "next from: …"). The tail is always a contiguous suffix, so a single
	 * boundary captures it (vs a file-id set, which mis-handles duplicates).
	 * Equals `tracks.length` when there is no tail. Persisted in queue state as
	 * `continuation_from_index` so it survives reload / cross-tab sync.
	 */
	continuationFromIndex = $state(0);

	/**
	 * "the user explicitly cleared the queue" intent. Suppresses backfill until
	 * the next explicit play context so "clear upcoming" actually clears.
	 * Persisted (`continuation_suppressed`) so the clear is authoritative across
	 * tabs and reloads, not just in the tab that clicked it.
	 */
	suppressContinuation = false;
	private backfilling = false;

	/** whether the track at `index` is part of the continuation tail */
	isContinuationIndex(index: number): boolean {
		return index >= this.continuationFromIndex && index < this.tracks.length;
	}

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
	private positionSaveInterval: number | null = null;
	private lastSavedProgressMs = 0;

	get currentTrack(): Track | null {
		if (this.tracks.length === 0) return null;
		return this.tracks[this.currentIndex] ?? null;
	}

	get hasNext(): boolean {
		return this.currentIndex < this.tracks.length - 1;
	}

	/**
	 * The track that natural end-of-track continuation should attempt next.
	 *
	 * Today: the next item in the hard queue, if any. Player.svelte uses
	 * this both to prefetch the upcoming source while the current track
	 * is still playing AND as the synchronous decision in the audio
	 * `ended` handler — the locked-screen autoplay grace requires that
	 * the swap to the next source happens in the same tick as the
	 * `ended` event, with no `await` in the path.
	 *
	 * Future: this is the seam where the Player asks "what should
	 * play next" without caring whether the answer comes from the
	 * hard queue, an album/playlist tail, a feed continuation, or a
	 * recommendation. Keep callers reading this getter, not poking
	 * `tracks[currentIndex + 1]` directly.
	 */
	get autoAdvanceTrack(): Track | null {
		if (this.currentIndex < 0) return null;
		return this.tracks[this.currentIndex + 1] ?? null;
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
		this.startPositionSave();
	}

	handleVisibilityChange = () => {
		if (document.visibilityState === 'hidden') {
			void this.flushSync();
		}
	};

	handleBeforeUnload = () => {
		this.stopPositionSave();
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
			return;
		}

		// always save position if playing something
		if (this.tracks.length > 0 && !this.syncInProgress) {
			await this.pushQueue();
		}
	}

	private isAuthenticated(): boolean {
		if (!browser) return false;
		return auth.isAuthenticated;
	}

	async fetchQueue(force = false) {
		if (!browser) return;
		if (!this.isAuthenticated()) return; // skip if not authenticated
		if (this.jamBridge) return; // jam owns the queue state

		// while we have unsent or in-flight local changes, skip non-forced fetches
		if (
			!force &&
			(this.syncInProgress || this.syncTimer !== null || this.pendingSync)
		) {
			return;
		}

		try {
			this.hydrating = true;

			const headers: HeadersInit = {};

			if (this.etag && !force) {
				headers['If-None-Match'] = this.etag;
			}

			const response = await fetch(`${API_URL}/queue/`, {
				headers,
				credentials: 'include'
			});

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

			// jam may have activated while fetch was in flight
			if (this.jamBridge) return;

			this.revision = data.revision;
			this.etag = newEtag;

			this.lastUpdateWasLocal = false;
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

		if (state.progress_ms !== undefined) {
			this.progressMs = state.progress_ms;
		}

		this.currentIndex = this.resolveCurrentIndex(
			state.current_track_id,
			state.current_index,
			this.tracks
		);

		// restore the continuation boundary (clamped). older states
		// without the field => no tail (boundary at end).
		const restored = state.continuation_from_index;
		this.continuationFromIndex =
			typeof restored === 'number'
				? Math.max(0, Math.min(restored, this.tracks.length))
				: this.tracks.length;

		// restore the "user cleared it" intent so clear stays authoritative
		// across tabs/reload (a refilling tab can't undo another's clear)
		this.suppressContinuation = state.continuation_suppressed ?? false;
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

	syncState() {
		if (!browser) return;
		if (this.jamBridge) {
			this.jamBridge.pushQueueState();
		} else {
			this.schedulePush();
		}
	}

	async pushQueue(): Promise<boolean> {
		if (!browser) return false;
		if (!this.isAuthenticated()) return false; // skip if not authenticated
		if (this.jamBridge) return false; // jam owns the queue state

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
			const state: QueueState = {
				track_ids: this.tracks.map((t) => t.file_id),
				current_index: this.currentIndex,
				current_track_id: this.currentTrack?.file_id ?? null,
				shuffle: this.shuffle,
				repeat_mode: this.repeatMode,
				original_order_ids: this.originalOrder.map((t) => t.file_id),
				progress_ms: this.progressMs,
				continuation_from_index: this.continuationFromIndex,
				continuation_suppressed: this.suppressContinuation
			};

			const headers: HeadersInit = {
				'Content-Type': 'application/json'
			};

			if (this.revision !== null) {
				headers['If-Match'] = `"${this.revision}"`;
			}

			const response = await fetch(`${API_URL}/queue/`, {
				credentials: 'include',
				method: 'PUT',
				headers,
				keepalive: true,
				body: JSON.stringify({ state })
			});

			if (response.status === 401) {
				// session expired or invalid, stop trying to sync
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

	// ── playback control (routed through bridge when jam active) ──

	play(): void {
		if (this.jamBridge) {
			this.jamBridge.play();
		}
		// always set synchronously — in jam mode this ensures audioElement.play()
		// fires within the user gesture context (non-output devices are gated in
		// Player.svelte's paused-state-sync effect)
		player.paused = false;
	}

	pause(): void {
		if (this.jamBridge) {
			this.jamBridge.pause();
		}
		player.paused = true;
	}

	togglePlayPause(): void {
		if (player.paused) this.play();
		else this.pause();
	}

	seek(ms: number): void {
		if (this.jamBridge) {
			this.jamBridge.seek(ms);
		} else if (player.audioElement) {
			player.audioElement.currentTime = ms / 1000;
		}
	}

	// ── track mutations (routed through bridge when jam active) ──

	addTracks(tracks: Track[], playNow = false) {
		if (tracks.length === 0) return;

		this.lastUpdateWasLocal = true;
		this.suppressContinuation = false;

		// explicit adds slot ahead of the continuation tail (so the user's own picks
		// play before recommendations) but never before the current track —
		// which may itself be in the continuation once playback advances into it
		const insertAt = Math.max(this.continuationFromIndex, this.currentIndex + 1);
		this.tracks = [
			...this.tracks.slice(0, insertAt),
			...tracks,
			...this.tracks.slice(insertAt)
		];
		this.originalOrder = [...this.originalOrder, ...tracks];

		// keep the continuation suffix starting after the inserted explicit tracks
		this.continuationFromIndex =
			insertAt <= this.continuationFromIndex
				? this.continuationFromIndex + tracks.length
				: insertAt + tracks.length;

		if (playNow) {
			player.radio = null; // playing a track leaves radio mode
			this.currentIndex = insertAt;
		}

		this.syncState();
	}

	/**
	 * Append recommendation tracks as the "next from: for you" tail (deduped
	 * against the existing queue). The tail is a contiguous suffix anchored by
	 * `continuationFromIndex`.
	 */
	appendContinuation(tracks: Track[]) {
		const inQueue = new Set(this.tracks.map((t) => t.file_id));
		const fresh = tracks.filter((t) => !inQueue.has(t.file_id));
		if (fresh.length === 0) return;

		this.lastUpdateWasLocal = true;
		// if there's no tail yet, it begins where the current queue ends
		if (this.continuationFromIndex >= this.tracks.length) {
			this.continuationFromIndex = this.tracks.length;
		}
		this.tracks = [...this.tracks, ...fresh];
		this.originalOrder = [...this.originalOrder, ...fresh];
		this.syncState();
	}

	private resetContinuation() {
		this.continuationFromIndex = this.tracks.length;
	}

	/**
	 * Drop the auto-generated "next from" tail, keeping the explicit queue (and
	 * the currently-playing track if playback already advanced into the tail).
	 * Called when "keep playing" is turned off — the tail is materialized into
	 * `tracks` and persisted server-side, so declining to refill it isn't enough;
	 * the existing tail has to be removed or it outlives the setting.
	 */
	clearContinuation() {
		if (this.jamBridge) return; // jam owns the queue; never a continuation tail
		if (this.continuationFromIndex >= this.tracks.length) return; // no tail

		const keepUpTo = Math.max(this.continuationFromIndex, this.currentIndex + 1);
		if (keepUpTo < this.tracks.length) {
			const removedIds = new Set(this.tracks.slice(keepUpTo).map((t) => t.file_id));
			this.tracks = this.tracks.slice(0, keepUpTo);
			this.originalOrder = this.originalOrder.filter((t) => !removedIds.has(t.file_id));
		}
		this.continuationFromIndex = this.tracks.length;
		this.lastUpdateWasLocal = true;
		this.syncState();
	}

	setQueue(tracks: Track[], startIndex = 0) {
		if (tracks.length === 0) {
			this.clear();
			return;
		}

		this.lastUpdateWasLocal = true;
		this.suppressContinuation = false;
		this.tracks = [...tracks];
		this.originalOrder = [...tracks];
		this.currentIndex = this.clampIndex(startIndex);
		this.resetContinuation();
		this.syncState();
	}

	playNow(track: Track, autoPlay = true) {
		player.radio = null; // playing a track leaves radio mode
		this.lastUpdateWasLocal = autoPlay;
		this.suppressContinuation = false;
		// keep explicitly-queued up-next, but drop the stale "next from" tail —
		// the new track is a new context, so let backfill regenerate it
		const upNext = this.tracks.slice(this.currentIndex + 1, this.continuationFromIndex);
		this.tracks = [track, ...upNext];
		this.originalOrder = [...this.tracks];
		this.currentIndex = 0;
		this.resetContinuation();
		this.syncState();
	}

	clear() {
		this.lastUpdateWasLocal = true;
		this.suppressContinuation = false;
		this.tracks = [];
		this.originalOrder = [];
		this.currentIndex = 0;
		this.resetContinuation();
		this.syncState();
	}

	goTo(index: number) {
		if (index < 0 || index >= this.tracks.length) return;

		player.radio = null; // playing a queue item leaves radio mode
		this.lastUpdateWasLocal = true;
		this.currentIndex = index;
		this.syncState();
	}

	next() {
		if (this.tracks.length === 0) {
			console.warn('[queue.next] tracks empty, bailing');
			return;
		}

		if (this.currentIndex < this.tracks.length - 1) {
			this.lastUpdateWasLocal = true;
			this.currentIndex += 1;
			this.syncState();
		}
	}

	previous(forceSkip = false) {
		if (this.tracks.length === 0) return;

		if (this.currentIndex > 0 || forceSkip) {
			this.lastUpdateWasLocal = true;
			if (this.currentIndex > 0) {
				this.currentIndex -= 1;
			}
			this.syncState();
			return true;
		}
		return false;
	}

	toggleShuffle() {
		if (this.jamBridge) return; // no shuffle command — block during jams
		// shuffle is an action, not a mode - shuffle upcoming tracks every time
		if (this.tracks.length <= 1) {
			return;
		}

		this.lastUpdateWasLocal = true;

		// shuffle only the explicit up-next; leave the current track, history,
		// and the auto-generated continuation tail untouched
		const before = this.tracks.slice(0, this.currentIndex + 1);
		const explicitEnd = Math.max(this.currentIndex + 1, this.continuationFromIndex);
		const after = this.tracks.slice(this.currentIndex + 1, explicitEnd);
		const continuationTail = this.tracks.slice(explicitEnd);

		// if only one track in the explicit up next, nothing to shuffle
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

		// rebuild: history + current + shuffled explicit up-next + continuation tail.
		// counts are preserved on both sides of the boundary, so it stays put.
		this.tracks = [...before, ...shuffled, ...continuationTail];

		this.schedulePush();
	}

	toggleRepeatMode() {
		if (this.jamBridge) return;
		if (this.repeatMode === 'none') {
			this.repeatMode = 'all';
		} else if (this.repeatMode === 'all') {
			this.repeatMode = 'one';
		} else {
			this.repeatMode = 'none';
		}
		this.syncState();
	}

	moveTrack(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex) return;
		if (fromIndex < 0 || fromIndex >= this.tracks.length) return;
		if (toIndex < 0 || toIndex >= this.tracks.length) return;

		const boundary = this.continuationFromIndex;
		const fromContinuation = fromIndex >= boundary;

		// an explicit pick can't be buried into the continuation tail — clamp it
		// to stay within the explicit region (the suffix boundary stays put)
		if (!fromContinuation && boundary < this.tracks.length) {
			toIndex = Math.max(0, Math.min(toIndex, boundary - 1));
		}
		if (fromIndex === toIndex) return;

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

		// boundary maintenance:
		// - explicit reorder (clamped above): the moved item stays explicit and
		//   the prefix size is unchanged → boundary unchanged.
		// - continuation drag UP into the explicit prefix (toIndex < boundary):
		//   the item is promoted to the queue → prefix grows by one.
		// - continuation reorder within the tail (toIndex >= boundary): unchanged.
		if (fromContinuation && toIndex < boundary) {
			this.continuationFromIndex = Math.min(boundary + 1, updated.length);
		}

		this.tracks = updated;

		if (!this.shuffle) {
			this.originalOrder = [...updated];
		}

		this.syncState();
	}

	removeTrack(index: number) {
		if (index < 0 || index >= this.tracks.length) return;
		if (index === this.currentIndex) return;

		this.lastUpdateWasLocal = true;
		const updated = [...this.tracks];
		const [removed] = updated.splice(index, 1);

		this.tracks = updated;
		this.originalOrder = this.originalOrder.filter((track) => track.file_id !== removed.file_id);

		// removing an explicit track shifts the continuation suffix left; removing
		// a continuation one just shrinks it
		if (index < this.continuationFromIndex) {
			this.continuationFromIndex -= 1;
		}
		this.continuationFromIndex = Math.min(this.continuationFromIndex, updated.length);

		if (updated.length === 0) {
			this.currentIndex = 0;
			this.syncState();
			return;
		}

		if (index < this.currentIndex) {
			this.currentIndex -= 1;
		} else if (index === this.currentIndex) {
			this.currentIndex = this.clampIndex(this.currentIndex);
		}

		this.syncState();
	}

	clearUpNext() {
		if (this.tracks.length === 0) return;

		this.lastUpdateWasLocal = true;

		// keep only the current track
		const currentTrack = this.tracks[this.currentIndex];
		if (!currentTrack) return;

		// explicit "clear" intent — don't let backfill immediately refill it
		this.suppressContinuation = true;
		this.tracks = [currentTrack];
		this.originalOrder = [currentTrack];
		this.currentIndex = 0;
		this.resetContinuation();

		this.syncState();
	}

	/**
	 * "keep playing": top up the queue tail from the For You feed. Appends
	 * real tracks ahead of the current track ending so the Player's
	 * synchronous prefetch can resolve them. No-op in a jam (jam owns the
	 * queue) or when the feed has nothing fresh to offer.
	 */
	async fillContinuation(): Promise<void> {
		if (!browser) return;
		if (this.jamBridge) return;
		if (this.suppressContinuation) return;
		if (this.backfilling) return;

		this.backfilling = true;
		try {
			if (forYouCache.tracks.length === 0) {
				await forYouCache.fetch();
			}

			const inQueue = new Set(this.tracks.map((t) => t.file_id));
			const currentId = this.currentTrack?.file_id;
			const candidates = () =>
				forYouCache.tracks.filter(
					(t) => !inQueue.has(t.file_id) && t.file_id !== currentId
				);

			let fresh = candidates();
			if (fresh.length < CONTINUATION_BATCH && forYouCache.hasMore) {
				await forYouCache.fetchMore();
				fresh = candidates();
			}

			if (fresh.length === 0) return;
			this.appendContinuation(fresh.slice(0, CONTINUATION_BATCH));
		} finally {
			this.backfilling = false;
		}
	}

	startPositionSave() {
		this.stopPositionSave();
		this.positionSaveInterval = window.setInterval(() => {
			if (this.tracks.length > 0 && Math.abs(this.progressMs - this.lastSavedProgressMs) > 5000) {
				this.lastSavedProgressMs = this.progressMs;
				void this.pushQueue();
			}
		}, 30_000);
	}

	stopPositionSave() {
		if (this.positionSaveInterval !== null) {
			window.clearInterval(this.positionSaveInterval);
			this.positionSaveInterval = null;
		}
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
