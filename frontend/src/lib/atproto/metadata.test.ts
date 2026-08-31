import { describe, expect, it } from 'vitest';
import { buildClientMetadata, clientWriteScope } from './metadata';

describe('buildClientMetadata', () => {
	it('hosts its identity at the origin and points back at the callback route', () => {
		const meta = buildClientMetadata('https://stg.plyr.fm', 'fm.plyr.stg');
		expect(meta.client_id).toBe('https://stg.plyr.fm/oauth-client-metadata.json');
		expect(meta.redirect_uris).toEqual(['https://stg.plyr.fm/atproto/callback']);
		expect(meta.scope).toBe('atproto repo:fm.plyr.stg.like?action=create&action=delete');
		expect(meta.token_endpoint_auth_method).toBe('none');
		expect(meta.dpop_bound_access_tokens).toBe(true);
	});

	it('becomes a loopback client for local dev', () => {
		const { client_id } = buildClientMetadata('http://127.0.0.1:5173', 'fm.plyr.dev');
		if (client_id == null) throw new Error('loopback client_id missing');
		expect(client_id.startsWith('http://localhost?redirect_uri=')).toBe(true);
		expect(client_id).toContain(encodeURIComponent('http://127.0.0.1:5173/atproto/callback'));
		expect(client_id).toContain(encodeURIComponent(clientWriteScope('fm.plyr.dev')));
	});
});
