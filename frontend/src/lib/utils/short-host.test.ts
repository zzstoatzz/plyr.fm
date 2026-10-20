import { describe, expect, it } from 'vitest';

import { shortHost } from './short-host';

describe('shortHost', () => {
	it('leaves ordinary hosts alone', () => {
		expect(shortHost('bsky.social')).toBe('bsky.social');
		expect(shortHost('pds.zzstoatzz.io')).toBe('pds.zzstoatzz.io');
	});

	it('keeps only the domain of long hosts', () => {
		expect(shortHost('pds.some-really-long-subdomain.example-hosting.network')).toBe(
			'example-hosting.network'
		);
		expect(shortHost('morel.us-east.host.bsky.network')).toBe('bsky.network');
	});
});
