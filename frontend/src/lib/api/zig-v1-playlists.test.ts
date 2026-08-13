import { describe, expect, it, vi } from 'vitest';
import { getZigPlaylist, listZigPlaylists } from './zig-v1-playlists';

const track = {
	object: 'track',
	id: 'trk_opaque',
	record: {
		uri: 'at://did:plc:artist/fm.plyr.track/song',
		cid: 'bafytrack',
		revision: '3msrevision',
		collection: 'fm.plyr.track',
		rkey: 'song'
	},
	metadata: {
		title: 'Song',
		artist_name: null,
		description: null,
		album: null,
		duration_seconds: 42,
		created_at: '2026-08-09T00:00:00Z'
	},
	artist: {
		did: 'did:plc:artist',
		profile: { handle: 'artist.test', display_name: 'Artist', avatar_url: null, bio: null }
	},
	media: {
		origins: [
			{
				url: 'https://audio.test/song.mp3',
				media_type: 'audio/mpeg',
				artifact_cid: null,
				source: 'verified_repo'
			}
		],
		artwork: null
	},
	access: { visibility: 'public', in_discovery: true, gate: null },
	moderation: { self_labels: [], operator_labels: [] },
	metrics: { play_count: 3, like_count: 2 },
	projection: { verification: 'verified_repo' }
};

const playlist = {
	object: 'playlist',
	id: 'pls_opaque',
	record: {
		uri: 'at://did:plc:owner/fm.plyr.list/road-mix',
		cid: 'bafyplaylist',
		collection: 'fm.plyr.list',
		rkey: 'road-mix'
	},
	metadata: {
		name: 'Road mix',
		created_at: '2026-08-09T00:00:00Z',
		updated_at: null
	},
	owner: {
		did: 'did:plc:owner',
		profile: { handle: 'owner.test', display_name: 'Owner', avatar_url: null }
	},
	members: [
		{
			position: 0,
			subject: { uri: track.record.uri, cid: track.record.cid },
			availability: 'available',
			track
		},
		{
			position: 1,
			subject: {
				uri: 'at://did:plc:artist/fm.plyr.track/unavailable',
				cid: 'bafyunavailable'
			},
			availability: 'unavailable',
			track: null
		}
	],
	metrics: { member_count: 2, available_count: 1, total_plays: 3 },
	sources: {
		record: 'verified_repo',
		membership: 'verified_repo',
		owner_identity: 'verified_repo',
		owner_profile: 'mixed',
		metrics: 'application_metrics',
		account_availability: 'verified_repo'
	},
	projection: {
		verification: 'verified_repo',
		commit_cid: 'bafycommit',
		commit_rev: '3msrevision',
		indexed_at_us: 42
	}
};
const { members: _members, ...playlistSummary } = playlist;

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('Zig v1 playlist compatibility boundary', () => {
	it('maps an owner-scoped cursor page without inventing presentation', async () => {
		let requestedInput: RequestInfo | URL | null = null;
		const fetcher = vi.fn(async (input: RequestInfo | URL) => {
			requestedInput = input;
			return json({
				object: 'list',
				data: [playlistSummary],
				has_more: true,
				next_cursor: 'plscur_next'
			});
		});
		const page = await listZigPlaylists(
			'https://api.next.plyr.fm',
			'did:plc:owner',
			{ limit: 7, cursor: 'plscur_previous' },
			fetcher
		);
		const requested = new URL(String(requestedInput));
		expect(requested.pathname).toBe('/v1/playlists');
		expect(requested.searchParams.get('owner_did')).toBe('did:plc:owner');
		expect(requested.searchParams.get('limit')).toBe('7');
		expect(requested.searchParams.get('cursor')).toBe('plscur_previous');
		expect(page).toMatchObject({ has_more: true, next_cursor: 'plscur_next' });
		expect(page.playlists[0]).toMatchObject({
			id: 'pls_opaque',
			name: 'Road mix',
			owner_did: 'did:plc:owner',
			track_count: 2
		});
		expect(page.playlists[0]).not.toHaveProperty('tracks');
	});

	it('rejects a playlist page that escapes its requested owner', async () => {
		const fetcher = vi.fn(async () =>
			json({
				object: 'list',
				data: [
					{
						...playlistSummary,
						record: {
							...playlistSummary.record,
							uri: 'at://did:plc:other/fm.plyr.list/road-mix'
						},
						owner: { ...playlistSummary.owner, did: 'did:plc:other' }
					}
				],
				has_more: false,
				next_cursor: null
			})
		);
		await expect(
			listZigPlaylists('https://api.next.plyr.fm', 'did:plc:owner', {}, fetcher)
		).rejects.toThrow('escaped owner scope');
	});

	it('maps the verified detail while retaining signed member cardinality', async () => {
		let requested = '';
		const fetcher = vi.fn(async (input: RequestInfo | URL) => {
			requested = String(input);
			return json(playlist);
		});

		const result = await getZigPlaylist('https://api.next.plyr.fm', 'pls_opaque', fetcher);

		expect(requested).toBe('https://api.next.plyr.fm/v1/playlists/pls_opaque');
		expect(result).toMatchObject({
			id: 'pls_opaque',
			name: 'Road mix',
			owner_did: 'did:plc:owner',
			owner_handle: 'owner.test',
			track_count: 2,
			atproto_record_uri: playlist.record.uri,
			is_private: false
		});
		expect(result?.tracks.map((value) => value.id)).toEqual(['trk_opaque']);
	});

	it('does not manufacture a handle or name when no profile projection exists', async () => {
		const fetcher = vi.fn(async () =>
			json({
				...playlist,
				metadata: { ...playlist.metadata, name: null },
				owner: { did: 'did:plc:owner', profile: null }
			})
		);
		const result = await getZigPlaylist('https://api.next.plyr.fm', 'pls_opaque', fetcher);
		expect(result?.name).toBe('playlist');
		expect(result?.owner_handle).toBe('did:plc:owner');
	});

	it('rejects a hydrated track that differs from its signed strong reference', async () => {
		const mismatched = {
			...playlist,
			members: [
				{
					...playlist.members[0],
					subject: { ...playlist.members[0].subject, cid: 'bafydifferent' }
				},
				playlist.members[1]
			]
		};
		const fetcher = vi.fn(async () => json(mismatched));
		await expect(getZigPlaylist('https://api.next.plyr.fm', 'pls_opaque', fetcher)).rejects.toThrow(
			'changed its signed subject'
		);
	});

	it('rejects legacy presentation fields and broken ordered membership', async () => {
		const fetcher = vi.fn(async () =>
			json({
				...playlist,
				presentation: { image_url: 'https://legacy.test/image.webp' },
				members: playlist.members.map((member, index) => ({ ...member, position: index + 1 }))
			})
		);
		await expect(getZigPlaylist('https://api.next.plyr.fm', 'pls_opaque', fetcher)).rejects.toThrow(
			'invalid Zig playlist'
		);
	});

	it('preserves not-found without accepting unsafe path identifiers', async () => {
		const fetcher = vi.fn(async () => json({}, 404));
		await expect(
			getZigPlaylist('https://api.next.plyr.fm', 'pls_missing', fetcher)
		).resolves.toBeNull();
		await expect(
			getZigPlaylist('https://api.next.plyr.fm', '../playlists', fetcher)
		).rejects.toThrow('invalid playlist identifier');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
