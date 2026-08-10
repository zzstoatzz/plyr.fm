import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionData, PlaylistWithTracks } from '$lib/types';

vi.mock('$lib/config', () => ({
	API_URL: 'https://api.next.plyr.fm',
	IS_ZIG_V1: true
}));
vi.mock('$lib/branding', () => ({ APP_CANONICAL_URL: 'https://next.plyr.fm' }));
vi.mock('$lib/api/zig-v1-playlists', () => ({ getZigPlaylist: vi.fn() }));

import { getZigPlaylist } from '$lib/api/zig-v1-playlists';
import { load } from './+page.server';

const playlist: PlaylistWithTracks = {
	id: 'pls_opaque',
	name: 'Road mix',
	owner_did: 'did:plc:owner',
	owner_handle: 'owner.test',
	track_count: 0,
	show_on_profile: false,
	atproto_record_uri: 'at://did:plc:owner/fm.plyr.list/road-mix',
	is_private: false,
	created_at: '2026-08-09T00:00:00Z',
	tracks: []
};

describe('next playlist embed', () => {
	beforeEach(() => vi.clearAllMocks());

	it('uses the verified detail adapter and keeps links on the canary host', async () => {
		vi.mocked(getZigPlaylist).mockResolvedValue(playlist);
		const fetcher = vi.fn();
		const result = (await load({
			params: { id: 'pls_opaque' },
			fetch: fetcher
		} as unknown as Parameters<typeof load>[0])) as { collection: CollectionData };

		expect(getZigPlaylist).toHaveBeenCalledWith(
			'https://api.next.plyr.fm',
			'pls_opaque',
			fetcher
		);
		expect(result.collection).toMatchObject({
			title: 'Road mix',
			subtitleUrl: 'https://next.plyr.fm/u/owner.test',
			collectionUrl: 'https://next.plyr.fm/playlist/pls_opaque',
			tracks: []
		});
	});

	it('preserves a missing verified playlist as not found', async () => {
		vi.mocked(getZigPlaylist).mockResolvedValue(null);
		await expect(
			load({
				params: { id: 'pls_missing' },
				fetch: vi.fn()
			} as unknown as Parameters<typeof load>[0])
		).rejects.toMatchObject({ status: 404 });
	});
});
