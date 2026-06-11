// contract tests for the playlist API actions: endpoints, methods, payloads,
// credentials, and error extraction — the network ritual the playlist page
// relies on, asserted against a mocked fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
	addTrack,
	deletePlaylist,
	fetchRecommendations,
	removeTrack,
	reorderTracks,
	searchTracks,
	updatePlaylist,
	uploadCover
} from './playlist-actions';
import { API_URL } from './config';
import type { Track } from './types';

const PLAYLIST_ID = '7e7bc6e0-7207-4ba8-9978-4d6f358594cd';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function track(overrides: Partial<Track> = {}): Track {
	return {
		id: 63,
		title: 'maxwell',
		atproto_record_uri: 'at://did:plc:abc/fm.plyr.dev.track/3m6vshv6lxc25',
		atproto_record_cid: 'bafyreih',
		...overrides
	} as Track;
}

const fetchMock = vi.fn();

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	fetchMock.mockReset();
});

function lastRequest(): { url: string; init: RequestInit } {
	const [url, init] = fetchMock.mock.calls.at(-1)!;
	return { url, init };
}

describe('searchTracks', () => {
	it('queries the search endpoint with credentials and returns results', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ results: [{ id: 1, type: 'track' }] }));

		const results = await searchTracks('joe pass');

		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/search/?q=joe%20pass&type=tracks&limit=10`);
		expect(init.credentials).toBe('include');
		expect(results).toEqual([{ id: 1, type: 'track' }]);
	});

	it('throws on a failed response', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));

		await expect(searchTracks('x')).rejects.toThrow('search failed');
	});
});

describe('fetchRecommendations', () => {
	it('returns the recommendations payload', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ available: true, tracks: [track()] }));

		const recs = await fetchRecommendations(PLAYLIST_ID);

		expect(lastRequest().url).toBe(
			`${API_URL}/lists/playlists/${PLAYLIST_ID}/recommendations?limit=3`
		);
		expect(recs.available).toBe(true);
		expect(recs.tracks).toHaveLength(1);
	});

	it('degrades to unavailable instead of throwing', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));

		await expect(fetchRecommendations(PLAYLIST_ID)).resolves.toEqual({
			available: false,
			tracks: []
		});
	});
});

describe('addTrack', () => {
	it('fetches track details then posts its record refs to the playlist', async () => {
		const full = track();
		fetchMock
			.mockResolvedValueOnce(jsonResponse(full))
			.mockResolvedValueOnce(jsonResponse({ ok: true }));

		const added = await addTrack(PLAYLIST_ID, 63);

		expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/tracks/63`);
		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/lists/playlists/${PLAYLIST_ID}/tracks`);
		expect(init.method).toBe('POST');
		expect(init.credentials).toBe('include');
		expect(JSON.parse(init.body as string)).toEqual({
			track_uri: full.atproto_record_uri,
			track_cid: full.atproto_record_cid
		});
		expect(added).toEqual(full);
	});

	it('rejects tracks without an ATProto record before posting', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(track({ atproto_record_uri: undefined })));

		await expect(addTrack(PLAYLIST_ID, 63)).rejects.toThrow('track does not have ATProto record');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("surfaces the server's error detail", async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(track()))
			.mockResolvedValueOnce(jsonResponse({ detail: 'playlist is full' }, 400));

		await expect(addTrack(PLAYLIST_ID, 63)).rejects.toThrow('playlist is full');
	});
});

describe('removeTrack', () => {
	it('deletes by url-encoded record uri', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
		const uri = 'at://did:plc:abc/fm.plyr.dev.track/3m6vshv6lxc25';

		await removeTrack(PLAYLIST_ID, uri);

		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/lists/playlists/${PLAYLIST_ID}/tracks/${encodeURIComponent(uri)}`);
		expect(init.method).toBe('DELETE');
		expect(init.credentials).toBe('include');
	});
});

describe('updatePlaylist', () => {
	it('patches only the provided fields as form data', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'renamed', show_on_profile: true }));

		await updatePlaylist(PLAYLIST_ID, { name: 'renamed' });

		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/lists/playlists/${PLAYLIST_ID}`);
		expect(init.method).toBe('PATCH');
		const form = init.body as FormData;
		expect(form.get('name')).toBe('renamed');
		expect(form.has('show_on_profile')).toBe(false);
		expect(form.has('is_private')).toBe(false);
	});

	it('serializes visibility toggles as strings', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ is_private: true }));

		await updatePlaylist(PLAYLIST_ID, { is_private: true });

		expect((lastRequest().init.body as FormData).get('is_private')).toBe('true');
	});

	it("surfaces the server's error detail", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'name too long' }, 422));

		await expect(updatePlaylist(PLAYLIST_ID, { name: 'x' })).rejects.toThrow('name too long');
	});
});

describe('uploadCover', () => {
	it('posts the image as multipart form data', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ image_url: '/img.webp' }));
		const file = new File(['png'], 'cover.png', { type: 'image/png' });

		const result = await uploadCover(PLAYLIST_ID, file);

		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/lists/playlists/${PLAYLIST_ID}/cover`);
		expect(init.method).toBe('POST');
		expect((init.body as FormData).get('image')).toBe(file);
		expect(result.image_url).toBe('/img.webp');
	});
});

describe('reorderTracks', () => {
	it('puts uri/cid pairs for tracks with ATProto records', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
		const withRecord = track();
		const withoutRecord = track({
			id: 99,
			atproto_record_uri: undefined,
			atproto_record_cid: undefined
		});

		const saved = await reorderTracks(PLAYLIST_ID, [withRecord, withoutRecord]);

		expect(saved).toBe(true);
		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/lists/playlists/${PLAYLIST_ID}/reorder`);
		expect(init.method).toBe('PUT');
		expect(JSON.parse(init.body as string)).toEqual({
			items: [
				{
					uri: withRecord.atproto_record_uri,
					cid: withRecord.atproto_record_cid
				}
			]
		});
	});

	it('skips the request entirely when no track has a record', async () => {
		const saved = await reorderTracks(PLAYLIST_ID, [
			track({ atproto_record_uri: undefined, atproto_record_cid: undefined })
		]);

		expect(saved).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('deletePlaylist', () => {
	it('deletes the playlist', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

		await deletePlaylist(PLAYLIST_ID);

		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/lists/playlists/${PLAYLIST_ID}`);
		expect(init.method).toBe('DELETE');
		expect(init.credentials).toBe('include');
	});

	it('throws on failure', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));

		await expect(deletePlaylist(PLAYLIST_ID)).rejects.toThrow('failed to delete playlist');
	});
});
