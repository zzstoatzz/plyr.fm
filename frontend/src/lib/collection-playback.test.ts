// tests for collection playback: the empty-collection guards and the
// "toast only when playback actually started" gating around playQueue.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const playQueueMock = vi.hoisted(() => vi.fn());
const playCollectionContextMock = vi.hoisted(() => vi.fn());
const playTrackMock = vi.hoisted(() => vi.fn());
const addTracksMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const prefs = vi.hoisted(() => ({ playThroughCollections: true }));

vi.mock('$lib/playback.svelte', () => ({
	playQueue: playQueueMock,
	playCollectionContext: playCollectionContextMock,
	playTrack: playTrackMock
}));
vi.mock('$lib/queue.svelte', () => ({ queue: { addTracks: addTracksMock } }));
vi.mock('$lib/preferences.svelte', () => ({ preferences: prefs }));
vi.mock('$lib/toast.svelte', () => ({ toast: { success: toastSuccessMock } }));

import { playCollection, playCollectionFrom, queueCollection } from './collection-playback';
import type { Track } from './types';

const TRACKS = [{ id: 1 }, { id: 2 }] as Track[];

beforeEach(() => {
	vi.clearAllMocks();
	prefs.playThroughCollections = true;
});

describe('playCollection', () => {
	it('plays the tracks and toasts the collection name', async () => {
		playQueueMock.mockResolvedValueOnce(true);

		await expect(playCollection(TRACKS, 'road mix')).resolves.toBe(true);

		expect(playQueueMock).toHaveBeenCalledWith(TRACKS);
		expect(toastSuccessMock).toHaveBeenCalledWith('playing road mix', 1800);
	});

	it('does not toast when playback was blocked (e.g. gated first track)', async () => {
		playQueueMock.mockResolvedValueOnce(false);

		await expect(playCollection(TRACKS, 'road mix')).resolves.toBe(false);

		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it('is a no-op for an empty collection', async () => {
		await expect(playCollection([], 'road mix')).resolves.toBe(false);

		expect(playQueueMock).not.toHaveBeenCalled();
	});
});

describe('playCollectionFrom', () => {
	it('plays through the collection from the tapped track when the setting is on (default)', async () => {
		playCollectionContextMock.mockResolvedValueOnce(true);

		await expect(playCollectionFrom(TRACKS, TRACKS[1], 'road mix')).resolves.toBe(true);

		// resolves the tapped track's index (1) and continues from there
		expect(playCollectionContextMock).toHaveBeenCalledWith(TRACKS, 1, 'road mix');
		expect(playTrackMock).not.toHaveBeenCalled();
	});

	it('plays only the tapped track when opted out', async () => {
		prefs.playThroughCollections = false;
		playTrackMock.mockResolvedValueOnce(true);

		await expect(playCollectionFrom(TRACKS, TRACKS[1], 'road mix')).resolves.toBe(true);

		expect(playTrackMock).toHaveBeenCalledWith(TRACKS[1]);
		expect(playCollectionContextMock).not.toHaveBeenCalled();
	});

	it('is a no-op for an empty collection', async () => {
		await expect(playCollectionFrom([], TRACKS[0], 'road mix')).resolves.toBe(false);
		expect(playCollectionContextMock).not.toHaveBeenCalled();
		expect(playTrackMock).not.toHaveBeenCalled();
	});
});

describe('queueCollection', () => {
	it('appends the tracks and toasts the collection name', () => {
		queueCollection(TRACKS, 'road mix');

		expect(addTracksMock).toHaveBeenCalledWith(TRACKS);
		expect(toastSuccessMock).toHaveBeenCalledWith('added road mix to queue', 1800);
	});

	it('is a no-op for an empty collection', () => {
		queueCollection([], 'road mix');

		expect(addTracksMock).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});
});
