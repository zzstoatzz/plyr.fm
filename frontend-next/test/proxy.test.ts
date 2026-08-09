import { describe, expect, test } from 'bun:test';
import { onRequest } from '../functions/api/[[path]].js';

describe('Pages Zig transport', () => {
	test('rejects writes before contacting the backend', async () => {
		const response = await onRequest({
			request: new Request('https://next.plyr.fm/api/v1/tracks', { method: 'POST' }),
			params: { path: ['v1', 'tracks'] }
		});
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('GET, HEAD');
	});

	test('does not expose non-v1 paths', async () => {
		const response = await onRequest({
			request: new Request('https://next.plyr.fm/api/health'),
			params: { path: ['health'] }
		});
		expect(response.status).toBe(404);
	});
});
