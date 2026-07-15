import { describe, expect, it } from 'vitest';

import { IMAGE_WIDTHS, resizedImageUrl } from './display-image';

describe('resizedImageUrl', () => {
	it('rewrites plyr image hosts to a transformation URL', () => {
		expect(
			resizedImageUrl('https://images.plyr.fm/images/abc123.jpeg', 640)
		).toBe(
			'https://images.plyr.fm/cdn-cgi/image/width=640,quality=82,format=auto/images/abc123.jpeg'
		);
		expect(resizedImageUrl('https://images-stg.plyr.fm/xyz.png', 96)).toBe(
			'https://images-stg.plyr.fm/cdn-cgi/image/width=96,quality=82,format=auto/xyz.png'
		);
	});

	it('passes external hosts through unchanged', () => {
		const bsky =
			'https://cdn.bsky.app/img/avatar/plain/did:plc:x/bafkrei@jpeg';
		expect(resizedImageUrl(bsky, 640)).toBe(bsky);
		const r2 = 'https://pub-308b.r2.dev/abc.jpg';
		expect(resizedImageUrl(r2, 640)).toBe(r2);
	});

	it('does not double-transform an already-transformed URL', () => {
		const once = resizedImageUrl(
			'https://images.plyr.fm/images/abc123.jpeg',
			IMAGE_WIDTHS.hero
		);
		expect(resizedImageUrl(once, IMAGE_WIDTHS.thumb)).toBe(once);
	});

	it('tolerates null, undefined, and unparseable input', () => {
		expect(resizedImageUrl(null, 640)).toBeNull();
		expect(resizedImageUrl(undefined, 640)).toBeNull();
		expect(resizedImageUrl('not a url', 640)).toBe('not a url');
	});
});
