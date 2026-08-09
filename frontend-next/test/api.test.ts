import { describe, expect, test } from 'bun:test';
import { ApiError, getArtist, getPlayback, listTracks } from '../public/api.js';

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

	describe('Zig v1 client', () => {
	test('encodes cursor and artist scope without changing the REST contract', async () => {
		const requests: URL[] = [];
		const fetcher = async (input: string | URL | Request): Promise<Response> => {
			requests.push(new URL(String(input)));
			return jsonResponse({ object: 'list', data: [], has_more: false, next_cursor: null });
		};

		await listTracks({ limit: 12, cursor: 'trkcur_+/=', artistDid: 'did:plc:abc' }, fetcher);

		expect(requests[0]?.pathname).toBe('/api/v1/tracks');
		expect(requests[0]?.searchParams.get('limit')).toBe('12');
		expect(requests[0]?.searchParams.get('cursor')).toBe('trkcur_+/=');
		expect(requests[0]?.searchParams.get('artist_did')).toBe('did:plc:abc');
	});

	test('rejects a Python-shaped collection instead of laundering it into v1', async () => {
		const fetcher = async (): Promise<Response> => jsonResponse({ tracks: [], has_more: false });
		await expect(listTracks({}, fetcher)).rejects.toThrow('invalid track collection response');
	});

	test('resolves artists by an encoded opaque identifier', async () => {
		let path = '';
		const fetcher = async (input: string | URL | Request): Promise<Response> => {
			path = new URL(String(input)).pathname;
			return jsonResponse({
				object: 'artist',
				did: 'did:plc:abc',
				handle: 'artist.test',
				display_name: 'Artist',
				avatar_url: null,
				bio: null
			});
		};
		await getArtist('did:plc:abc', fetcher);
		expect(path).toBe('/api/v1/artists/did:plc:abc');
	});

	test('rejects artist identifiers that can change route shape', async () => {
		await expect(getArtist('did:plc:a/b')).rejects.toThrow('invalid artist identifier');
	});

	test('rejects an embedded-profile shape for the flat artist resource', async () => {
		const fetcher = async (): Promise<Response> => jsonResponse({
			object: 'artist',
			did: 'did:plc:abc',
			profile: { handle: 'artist.test', display_name: 'Artist' }
		});
		await expect(getArtist('did:plc:abc', fetcher)).rejects.toThrow('invalid artist response');
	});

	test('requires playback to round-trip the requested track identity', async () => {
		const fetcher = async (): Promise<Response> => jsonResponse({
			object: 'playback',
			track_id: 'trk_other',
			availability: { status: 'unavailable', delivery: null }
		});
		await expect(getPlayback('trk_expected', fetcher)).rejects.toThrow('invalid playback response');
	});

	test('keeps HTTP failures typed', async () => {
		const fetcher = async (): Promise<Response> => jsonResponse({}, 503);
		try {
			await listTracks({}, fetcher);
			throw new Error('expected failure');
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			expect((error as ApiError).status).toBe(503);
		}
	});
});
