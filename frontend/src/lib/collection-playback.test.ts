// tests for collection playback: the empty-collection guards and the
// "toast only when playback actually started" gating around playQueue.
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { playCollection, playCollectionFrom, queueCollection } from './collection-playback';
import { preferences, type Preferences } from './preferences.svelte';
import { queue } from './queue.svelte';
import { toast } from './toast.svelte';
import type { Track } from './types';

function track(id: number, extra: Partial<Track> = {}): Track {
	return {
		id,
		title: `track ${id}`,
		artist: 'artist',
		artist_handle: 'artist.test',
		file_id: `file-${id}`,
		file_type: 'mp3',
		play_count: 0,
		...extra
	};
}

function prefs(playThroughCollections: boolean): Preferences {
	return {
		accent_color: null,
		auto_advance: true,
		allow_comments: true,
		download_policy: null,
		hidden_tags: [],
		theme: 'dark',
		enable_teal_scrobbling: false,
		teal_needs_reauth: false,
		show_sensitive_artwork: false,
		show_sensitive_audio: false,
		show_liked_on_profile: false,
		support_url: null,
		ui_settings: { play_through_collections: playThroughCollections },
		auto_download_liked: false,
		terms_accepted_at: null
	};
}

const TRACKS = [track(1), track(2)];

// gated tracks are verified with a HEAD request; answer 401 so the first track is denied
const fetchSpy = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 401 })));
vi.stubGlobal('fetch', fetchSpy);

function queuedIds(): number[] {
	return queue.tracks.map((t) => t.id);
}

function toastMessages(): string[] {
	return toast.toasts.map((t) => t.message);
}

beforeEach(() => {
	fetchSpy.mockClear();
	queue.clear();
	toast.toasts = [];
	preferences.data = prefs(true);
});

describe('playCollection', () => {
	it('plays the tracks and toasts the collection name', async () => {
		await expect(playCollection(TRACKS, 'road mix')).resolves.toBe(true);

		expect(queuedIds()).toEqual([1, 2]);
		expect(queue.currentIndex).toBe(0);
		expect(toast.toasts).toMatchObject([{ message: 'playing road mix', type: 'success', duration: 1800 }]);
	});

	it('does not toast when playback was blocked (e.g. gated first track)', async () => {
		const gated = [track(1, { gated: true }), track(2)];

		await expect(playCollection(gated, 'road mix')).resolves.toBe(false);

		expect(queuedIds()).toEqual([]);
		expect(toastMessages()).not.toContain('playing road mix');
	});

	it('is a no-op for an empty collection', async () => {
		await expect(playCollection([], 'road mix')).resolves.toBe(false);

		expect(queuedIds()).toEqual([]);
		expect(toast.toasts).toEqual([]);
	});
});

describe('playCollectionFrom', () => {
	it('plays through the collection from the tapped track when the setting is on (default)', async () => {
		await expect(playCollectionFrom([...TRACKS, track(3)], TRACKS[1], 'road mix')).resolves.toBe(true);

		// resolves the tapped track's index and lines the remainder up as the labeled tail
		expect(queuedIds()).toEqual([2, 3]);
		expect(queue.currentIndex).toBe(0);
		expect(queue.continuationLabel).toBe('road mix');
	});

	it('plays only the tapped track when opted out', async () => {
		preferences.data = prefs(false);

		await expect(playCollectionFrom(TRACKS, TRACKS[1], 'road mix')).resolves.toBe(true);

		expect(queuedIds()).toEqual([2]);
		expect(queue.continuationLabel).toBeNull();
	});

	it('is a no-op for an empty collection', async () => {
		await expect(playCollectionFrom([], TRACKS[0], 'road mix')).resolves.toBe(false);
		expect(queuedIds()).toEqual([]);
	});
});

describe('queueCollection', () => {
	it('appends the tracks and toasts the collection name', () => {
		queueCollection(TRACKS, 'road mix');

		expect(queuedIds()).toEqual([1, 2]);
		expect(toast.toasts).toMatchObject([
			{ message: 'added road mix to queue', type: 'success', duration: 1800 }
		]);
	});

	it('is a no-op for an empty collection', () => {
		queueCollection([], 'road mix');

		expect(queuedIds()).toEqual([]);
		expect(toast.toasts).toEqual([]);
	});
});
