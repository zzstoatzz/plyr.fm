import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	fetchLuminframeImageAsFile,
	hasLuminframeImages,
	listLuminframeImages,
	recordToImage,
	resolvePdsEndpoint,
	type LuminframeImage
} from './luminframe';

const DID = 'did:plc:abc123';
const PDS = 'https://pds.example.com';

const RECORD = {
	uri: `at://${DID}/com.luminframe.image/3lcabcdef`,
	value: {
		image: {
			$type: 'blob',
			ref: { $link: 'bafkreiblob' },
			mimeType: 'image/webp',
			size: 12345
		},
		title: 'sunset remix',
		alt: 'a glitched sunset',
		createdAt: '2026-07-01T00:00:00Z',
		aspectRatio: { width: 800, height: 600 }
	}
};

function mockFetch(handler: (url: string) => Promise<Response> | Response) {
	const spy = vi.fn((input: RequestInfo | URL) => {
		return Promise.resolve(handler(String(input)));
	});
	vi.stubGlobal('fetch', spy);
	return spy;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('recordToImage', () => {
	it('shapes a listRecords entry into a picker item with a getBlob URL', () => {
		const image = recordToImage(RECORD, DID, PDS);
		expect(image).toEqual({
			uri: RECORD.uri,
			imageUrl: `${PDS}/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aabc123&cid=bafkreiblob`,
			mimeType: 'image/webp',
			title: 'sunset remix',
			alt: 'a glitched sunset',
			createdAt: '2026-07-01T00:00:00Z',
			aspectRatio: { width: 800, height: 600 }
		});
	});

	it('drops records with no image blob', () => {
		expect(recordToImage({ uri: RECORD.uri, value: {} }, DID, PDS)).toBeNull();
	});
});

describe('resolvePdsEndpoint', () => {
	it('resolves did:plc via plc.directory', async () => {
		mockFetch((url) => {
			expect(url).toBe(`https://plc.directory/${DID}`);
			return Response.json({
				service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }]
			});
		});
		expect(await resolvePdsEndpoint(DID)).toBe(PDS);
	});

	it('resolves did:web via .well-known', async () => {
		mockFetch((url) => {
			expect(url).toBe('https://pds.example.com/.well-known/did.json');
			return Response.json({
				service: [{ id: '#atproto_pds', serviceEndpoint: PDS }]
			});
		});
		expect(await resolvePdsEndpoint('did:web:pds.example.com')).toBe(PDS);
	});

	it('returns null for unknown did methods and network failures', async () => {
		expect(await resolvePdsEndpoint('did:key:zabc')).toBeNull();
		mockFetch(() => {
			throw new Error('network down');
		});
		expect(await resolvePdsEndpoint(DID)).toBeNull();
	});
});

describe('listLuminframeImages', () => {
	it('lists records from the resolved PDS and skips blobless entries', async () => {
		mockFetch((url) => {
			if (url.startsWith('https://plc.directory/')) {
				return Response.json({
					service: [{ id: '#atproto_pds', serviceEndpoint: PDS }]
				});
			}
			expect(url).toContain(`${PDS}/xrpc/com.atproto.repo.listRecords`);
			expect(url).toContain('collection=com.luminframe.image');
			return Response.json({
				records: [RECORD, { uri: 'at://x/com.luminframe.image/empty', value: {} }]
			});
		});
		const images = await listLuminframeImages(DID);
		expect(images).toHaveLength(1);
		expect(images[0].uri).toBe(RECORD.uri);
	});

	it('follows the cursor across pages', async () => {
		let page = 0;
		mockFetch((url) => {
			if (url.startsWith('https://plc.directory/')) {
				return Response.json({
					service: [{ id: '#atproto_pds', serviceEndpoint: PDS }]
				});
			}
			page += 1;
			if (page === 1) {
				expect(url).not.toContain('cursor=');
				return Response.json({
					records: Array.from({ length: 100 }, (_, i) => ({
						...RECORD,
						uri: `${RECORD.uri}${i}`
					})),
					cursor: 'next-page'
				});
			}
			expect(url).toContain('cursor=next-page');
			return Response.json({ records: [RECORD] });
		});
		const images = await listLuminframeImages(DID);
		expect(images).toHaveLength(101);
	});

	it('returns [] when the PDS cannot be resolved', async () => {
		mockFetch(() => Response.json({ service: [] }));
		expect(await listLuminframeImages(DID)).toEqual([]);
	});
});

describe('hasLuminframeImages', () => {
	it('is true when the collection has at least one record', async () => {
		mockFetch((url) => {
			if (url.startsWith('https://plc.directory/')) {
				return Response.json({
					service: [{ id: '#atproto_pds', serviceEndpoint: PDS }]
				});
			}
			expect(url).toContain('limit=1');
			return Response.json({ records: [RECORD] });
		});
		expect(await hasLuminframeImages(DID)).toBe(true);
	});

	it('is false for an empty collection, an unresolvable PDS, or a failed probe', async () => {
		mockFetch((url) =>
			url.startsWith('https://plc.directory/')
				? Response.json({ service: [{ id: '#atproto_pds', serviceEndpoint: PDS }] })
				: Response.json({ records: [] })
		);
		expect(await hasLuminframeImages(DID)).toBe(false);

		mockFetch(() => Response.json({ service: [] }));
		expect(await hasLuminframeImages(DID)).toBe(false);

		mockFetch((url) =>
			url.startsWith('https://plc.directory/')
				? Response.json({ service: [{ id: '#atproto_pds', serviceEndpoint: PDS }] })
				: new Response(null, { status: 500 })
		);
		expect(await hasLuminframeImages(DID)).toBe(false);
	});
});

describe('fetchLuminframeImageAsFile', () => {
	const image: LuminframeImage = {
		uri: `at://${DID}/com.luminframe.image/3lcabcdef`,
		imageUrl: `${PDS}/xrpc/com.atproto.sync.getBlob?did=${DID}&cid=bafkreiblob`,
		mimeType: 'image/webp',
		createdAt: '2026-07-01T00:00:00Z',
		aspectRatio: { width: 800, height: 600 }
	};

	it('wraps the blob as a File named after the record rkey', async () => {
		mockFetch(
			() =>
				new Response(new Uint8Array([1, 2, 3]), {
					headers: { 'Content-Type': 'image/webp' }
				})
		);
		const file = await fetchLuminframeImageAsFile(image);
		expect(file.name).toBe('luminframe-3lcabcdef.webp');
		expect(file.type).toBe('image/webp');
		expect(file.size).toBe(3);
	});

	it('falls back to the record mime type when the PDS serves a generic one', async () => {
		mockFetch(
			() =>
				new Response(new Uint8Array([1]), {
					headers: { 'Content-Type': 'application/octet-stream' }
				})
		);
		const file = await fetchLuminframeImageAsFile(image);
		expect(file.name).toBe('luminframe-3lcabcdef.webp');
		expect(file.type).toBe('image/webp');
	});

	it('collapses unknown image types to png so name and type agree', async () => {
		mockFetch(
			() =>
				new Response(new Uint8Array([1]), {
					headers: { 'Content-Type': 'image/avif' }
				})
		);
		const file = await fetchLuminframeImageAsFile(image);
		expect(file.name).toBe('luminframe-3lcabcdef.png');
		expect(file.type).toBe('image/png');
	});

	it('throws on a failed blob fetch', async () => {
		mockFetch(() => new Response(null, { status: 404 }));
		await expect(fetchLuminframeImageAsFile(image)).rejects.toThrow('404');
	});
});
