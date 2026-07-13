// regression: the SSR branch of the playlist load rebuilds the playlist
// object field-by-field from /meta; dropping a field there silently strips
// it from the OG head render (preview_thumbnails went missing → imageless
// link previews for composite covers).
import { describe, expect, it, vi } from 'vitest';
import type { LoadEvent } from '@sveltejs/kit';
import type { Playlist } from '$lib/types';

vi.mock('$app/environment', () => ({ browser: false }));

import { load } from './+page';

const meta: Playlist = {
	id: 'p1',
	name: 'ambient',
	owner_did: 'did:plc:owner',
	owner_handle: 'owner.test',
	track_count: 4,
	show_on_profile: false,
	atproto_record_uri: null,
	is_private: false,
	created_at: '2026-01-01T00:00:00Z',
	preview_thumbnails: ['a.webp', 'b.webp', 'c.webp', 'd.webp']
};

describe('playlist SSR load', () => {
	it('carries preview_thumbnails through to the head data', async () => {
		const result = await load({
			params: { id: 'p1' },
			data: { playlistMeta: meta }
		} as unknown as LoadEvent);

		expect(result.playlist.preview_thumbnails).toEqual(['a.webp', 'b.webp', 'c.webp', 'd.webp']);
	});

	it('defaults to no previews when meta is unavailable', async () => {
		const result = await load({
			params: { id: 'p1' },
			data: { playlistMeta: null }
		} as unknown as LoadEvent);

		expect(result.playlist.preview_thumbnails).toEqual([]);
	});
});
