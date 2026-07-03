// contract tests for the album API actions: endpoints, methods, payloads,
// credentials, and error extraction, asserted against a mocked fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { deleteAlbum, removeTrack, reorderTracks, updateTitle, uploadCover } from './album-actions';
import { API_URL } from './config';
import type { Track } from './types';

const ALBUM_ID = 'a1b2c3d4';
const LIST_URI = 'at://did:plc:abc/fm.plyr.dev.list/3m6vlistrkey1';

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

describe('updateTitle', () => {
	it('patches the title as a url-encoded query param', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

		await updateTitle(ALBUM_ID, 'new & improved');

		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/albums/${ALBUM_ID}?title=new%20%26%20improved`);
		expect(init.method).toBe('PATCH');
		expect(init.credentials).toBe('include');
	});

	it('throws the generic fallback when the response has no detail', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));

		await expect(updateTitle(ALBUM_ID, 'x')).rejects.toThrow('failed to update title');
	});

	it('surfaces the server detail so a slug-collision 409 reaches the toast', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse({ detail: 'another of your albums already uses that name' }, 409)
		);

		await expect(updateTitle(ALBUM_ID, 'x')).rejects.toThrow(
			'another of your albums already uses that name'
		);
	});
});

describe('uploadCover', () => {
	it('posts the image as multipart form data', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ image_url: '/img.webp' }));
		const file = new File(['png'], 'cover.png', { type: 'image/png' });

		const result = await uploadCover(ALBUM_ID, file);

		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/albums/${ALBUM_ID}/cover`);
		expect(init.method).toBe('POST');
		expect((init.body as FormData).get('image')).toBe(file);
		expect(result.image_url).toBe('/img.webp');
	});
});

describe('removeTrack', () => {
	it('deletes by track id', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

		await removeTrack(ALBUM_ID, 63);

		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/albums/${ALBUM_ID}/tracks/63`);
		expect(init.method).toBe('DELETE');
		expect(init.credentials).toBe('include');
	});

	it("surfaces the server's error detail", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'not your album' }, 403));

		await expect(removeTrack(ALBUM_ID, 63)).rejects.toThrow('not your album');
	});
});

describe('deleteAlbum', () => {
	it('deletes the album', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

		await deleteAlbum(ALBUM_ID);

		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/albums/${ALBUM_ID}`);
		expect(init.method).toBe('DELETE');
	});
});

describe('reorderTracks', () => {
	it('puts uri/cid pairs to the list rkey derived from the list uri', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
		const withRecord = track();
		const withoutRecord = track({
			id: 99,
			atproto_record_uri: undefined,
			atproto_record_cid: undefined
		});

		const saved = await reorderTracks(LIST_URI, [withRecord, withoutRecord]);

		expect(saved).toBe(true);
		const { url, init } = lastRequest();
		expect(url).toBe(`${API_URL}/lists/3m6vlistrkey1/reorder`);
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

	it('skips the request when the album has no list uri', async () => {
		const saved = await reorderTracks(null, [track()]);

		expect(saved).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('skips the request when no track has a record', async () => {
		const saved = await reorderTracks(LIST_URI, [
			track({ atproto_record_uri: undefined, atproto_record_cid: undefined })
		]);

		expect(saved).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("surfaces the server's error detail", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'list not found' }, 404));

		await expect(reorderTracks(LIST_URI, [track()])).rejects.toThrow('list not found');
	});
});
