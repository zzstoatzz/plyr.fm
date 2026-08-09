import { describe, expect, it, vi } from 'vitest';
import { getZigArtist, getZigPlayback, getZigTrack, listZigTracks, recordZigPlay } from './zig-v1';
import { getZigAlbum, listZigAlbums } from './zig-v1-albums';
import { searchZigCatalog } from './zig-v1-search';

const record = {
	uri: 'at://did:plc:artist/fm.plyr.track/song',
	cid: 'bafytrack',
	revision: '3msrevision',
	collection: 'fm.plyr.track',
	rkey: 'song'
};

const track = {
	object: 'track',
	id: 'trk_opaque',
	record,
	metadata: {
		title: 'Song',
		artist_name: null,
		description: 'Notes',
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
		]
	},
	access: { visibility: 'public', in_discovery: true, gate: null },
	moderation: { self_labels: [], operator_labels: [] },
	metrics: { play_count: 3 },
	projection: { verification: 'verified_repo' }
};

const artist = {
	object: 'artist',
	did: 'did:plc:artist',
	handle: 'artist.test',
	display_name: 'Artist',
	bio: 'authored bio',
	avatar_url: null,
	show_liked_on_profile: false,
	support_url: null,
	created_at: '2026-08-09T00:00:00Z',
	updated_at: '2026-08-09T00:00:00Z',
	record: {
		uri: 'at://did:plc:artist/fm.plyr.actor.profile/self',
		cid: 'bafyprofile',
		revision: '3msrevision',
		collection: 'fm.plyr.actor.profile',
		rkey: 'self'
	},
	sources: {
		did: 'verified_repo',
		handle: 'legacy_projection',
		display_name: 'legacy_local',
		profile: 'verified_repo',
		public_preferences: 'legacy_local',
		account_availability: 'verified_repo'
	},
	projection: { indexed_at: '2026-08-09T00:00:00Z', verification: 'verified_repo' }
};

const albumSummary = {
	object: 'album',
	id: 'alb_opaque',
	record: {
		uri: 'at://did:plc:artist/fm.plyr.list/album',
		cid: 'bafyalbum',
		collection: 'fm.plyr.list',
		rkey: 'album'
	},
	metadata: {
		name: 'Verified Album',
		created_at: '2026-08-09T00:00:00Z',
		updated_at: null
	},
	owner: {
		did: 'did:plc:artist',
		profile: { handle: 'artist.test', display_name: 'Artist', avatar_url: null }
	},
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

const albumDetail = {
	...albumSummary,
	members: [
		{
			position: 0,
			subject: { uri: record.uri, cid: record.cid },
			availability: 'available',
			track
		},
		{
			position: 1,
			subject: { uri: 'at://did:plc:artist/fm.plyr.track/missing', cid: 'bafymissing' },
			availability: 'unavailable',
			track: null
		}
	]
};

const searchTrack = {
	object: 'search_result',
	type: 'track',
	id: 'trk_opaque',
	record: { uri: record.uri, cid: record.cid },
	title: 'Song',
	owner: { did: 'did:plc:artist', handle: 'artist.test', display_name: 'Artist' },
	image_url: null,
	metrics: { play_count: 3, member_count: null },
	match: { kind: 'exact', field: 'title' },
	sources: {
		record: 'verified_repo',
		title: 'verified_repo',
		owner_identity: 'verified_repo',
		owner_handle: 'legacy_projection',
		owner_display_name: 'legacy_projection',
		image: 'derived',
		metrics: 'application_metrics',
		account_availability: 'verified_repo'
	},
	projection: { verification: 'verified_repo', indexed_at_us: 42 }
};

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('Zig v1 compatibility boundary', () => {
	it('maps verified search references into the existing search modal model', async () => {
		let requestedInput: RequestInfo | URL | null = null;
		const fetcher = vi.fn(async (input: RequestInfo | URL) => {
			requestedInput = input;
			return json({
				object: 'list',
				data: [searchTrack],
				query: 'Song',
				counts: { tracks: 1, artists: 0, albums: 0, playlists: 0 }
			});
		});
		const result = await searchZigCatalog(
			'https://next.plyr.fm/api',
			'Song',
			{ limit: 7 },
			fetcher
		);
		const requested = new URL(String(requestedInput));
		expect(requested.pathname).toBe('/api/v1/search');
		expect(requested.searchParams.get('types')).toBe('track,artist,album');
		expect(requested.searchParams.get('limit')).toBe('7');
		expect(result.results[0]).toEqual({
			type: 'track',
			id: 'trk_opaque',
			title: 'Song',
			artist_handle: 'artist.test',
			artist_display_name: 'Artist',
			image_url: null
		});
		expect(result.counts).toEqual({ tracks: 1, artists: 0, albums: 0, tags: 0, playlists: 0 });
	});

	it('rejects search results that lose provenance or escape the requested scope', async () => {
		const unverified = vi.fn(async () =>
			json({
				object: 'list',
				data: [
					{
						...searchTrack,
						sources: { ...searchTrack.sources, record: 'legacy_projection' }
					}
				],
				query: 'Song',
				counts: { tracks: 1, artists: 0, albums: 0, playlists: 0 }
			})
		);
		await expect(
			searchZigCatalog('https://next.plyr.fm/api', 'Song', {}, unverified)
		).rejects.toThrow('invalid Zig search result');

		const playlist = vi.fn(async () =>
			json({
				object: 'list',
				data: [
					{
						...searchTrack,
						type: 'playlist',
						id: 'pls_opaque',
						metrics: { play_count: null, member_count: 3 },
						match: { kind: 'prefix', field: 'name' }
					}
				],
				query: 'Song',
				counts: { tracks: 0, artists: 0, albums: 0, playlists: 1 }
			})
		);
		await expect(
			searchZigCatalog('https://next.plyr.fm/api', 'Song', {}, playlist)
		).rejects.toThrow('escaped requested type scope');
	});

	it('maps verified album summaries without inventing local presentation', async () => {
		const fetcher = vi.fn(async () =>
			json({ object: 'list', data: [albumSummary], has_more: false, next_cursor: null })
		);
		const page = await listZigAlbums('https://next.plyr.fm/api', 'did:plc:artist', {}, fetcher);
		expect(page.albums[0]).toEqual({
			id: 'alb_opaque',
			title: 'Verified Album',
			slug: 'alb_opaque',
			track_count: 2,
			total_plays: 3
		});
	});

	it('preserves unavailable signed membership when adapting album detail', async () => {
		const fetcher = vi.fn(async () => json(albumDetail));
		const album = await getZigAlbum('https://next.plyr.fm/api', 'alb_opaque', fetcher);
		expect(album?.metadata.list_uri).toBe(albumSummary.record.uri);
		expect(album?.tracks.map((value) => value.id)).toEqual(['trk_opaque']);
		expect(album?.unavailable_track_count).toBe(1);
	});

	it('rejects legacy presentation and broken verified album ordering', async () => {
		const fetcher = vi.fn(async () =>
			json({
				...albumDetail,
				presentation: { slug: 'legacy' },
				members: albumDetail.members.map((member, index) => ({ ...member, position: index + 1 }))
			})
		);
		await expect(getZigAlbum('https://next.plyr.fm/api', 'alb_opaque', fetcher)).rejects.toThrow(
			'invalid Zig album'
		);
	});

	it('accepts only verified artist resources and maps authored profile fields', async () => {
		const fetcher = vi.fn(async () => json(artist));
		const value = await getZigArtist('https://next.plyr.fm/api', 'artist.test', fetcher);
		expect(value).toEqual({
			did: 'did:plc:artist',
			handle: 'artist.test',
			display_name: 'Artist',
			bio: 'authored bio',
			avatar_url: undefined,
			show_liked_on_profile: false,
			support_url: undefined
		});
	});

	it('rejects artist resources whose profile provenance is not verified', async () => {
		const fetcher = vi.fn(async () =>
			json({ ...artist, sources: { ...artist.sources, profile: 'legacy_projection' } })
		);
		await expect(getZigArtist('https://next.plyr.fm/api', artist.did, fetcher)).rejects.toThrow(
			'invalid Zig artist resource'
		);
	});

	it('maps verified collection resources without inventing numeric identity', async () => {
		let requestedInput: RequestInfo | URL | null = null;
		const fetcher = vi.fn(async (input: RequestInfo | URL) => {
			requestedInput = input;
			return json({ object: 'list', data: [track], has_more: false, next_cursor: null });
		});
		const page = await listZigTracks('https://next.plyr.fm/api', { limit: 7 }, fetcher);
		const requested = new URL(String(requestedInput));
		expect(requested.pathname).toBe('/api/v1/tracks');
		expect(requested.searchParams.get('limit')).toBe('7');
		expect(page.tracks[0]?.id).toBe('trk_opaque');
		expect(page.tracks[0]?.file_id).toBe('trk_opaque');
		expect(page.tracks[0]?.atproto_record_uri).toBe(record.uri);
	});

	it('requires detail to round-trip the opaque resource identity', async () => {
		const fetcher = vi.fn(async () => json({ ...track, id: 'trk_other' }));
		await expect(getZigTrack('https://next.plyr.fm/api', 'trk_expected', fetcher)).rejects.toThrow(
			'changed resource identity'
		);
	});

	it('keeps playback resolution separate from catalog metadata', async () => {
		let requestedInput: RequestInfo | URL | null = null;
		const fetcher = vi.fn(async (input: RequestInfo | URL) => {
			requestedInput = input;
			return json({
				object: 'playback',
				track_id: 'trk_opaque',
				availability: {
					status: 'available',
					delivery: {
						url: 'https://audio.test/song.mp3',
						media_type: 'audio/mpeg',
						source: 'verified_delivery',
						integrity: 'verified_blob_cid'
					}
				}
			});
		});
		const playback = await getZigPlayback('https://next.plyr.fm/api', 'trk_opaque', fetcher);
		expect(playback.availability.delivery?.url).toBe('https://audio.test/song.mp3');
		expect(String(requestedInput)).toContain('/v1/tracks/trk_opaque/playback');
	});

	it('records sustained plays through the v1 write boundary with share attribution', async () => {
		let requestedInput: RequestInfo | URL | null = null;
		let requestedInit: RequestInit | undefined;
		const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			requestedInput = input;
			requestedInit = init;
			return json({
				object: 'play_receipt',
				track_id: 'trk_opaque',
				record: { uri: record.uri },
				play_count: 4,
				counted: true,
				dedup: { status: 'claimed', window_seconds: 42 },
				sources: { metrics: 'application_metrics', dedup: 'redis_ephemeral' }
			});
		});
		const receipt = await recordZigPlay(
			'https://next.plyr.fm/api',
			'trk_opaque',
			'share123',
			fetcher
		);
		const requested = new URL(String(requestedInput));
		expect(requested.pathname).toBe('/api/v1/tracks/trk_opaque/plays');
		expect(requested.searchParams.get('ref')).toBe('share123');
		expect(requestedInit).toMatchObject({ method: 'POST', credentials: 'include' });
		expect(receipt.play_count).toBe(4);
	});

	it('rejects malformed share references and contradictory play receipts', async () => {
		await expect(
			recordZigPlay('https://next.plyr.fm/api', 'trk_opaque', 'bad/ref', vi.fn())
		).rejects.toThrow('invalid share reference');
		const fetcher = vi.fn(async () =>
			json({
				object: 'play_receipt',
				track_id: 'trk_opaque',
				record: { uri: record.uri },
				play_count: 4,
				counted: false,
				dedup: { status: 'claimed', window_seconds: 42 },
				sources: { metrics: 'application_metrics', dedup: 'redis_ephemeral' }
			})
		);
		await expect(
			recordZigPlay('https://next.plyr.fm/api', 'trk_opaque', null, fetcher)
		).rejects.toThrow('invalid Zig play receipt');
	});

	it('rejects Python-shaped collections instead of silently adapting them', async () => {
		const fetcher = vi.fn(async () => json({ tracks: [track], has_more: false }));
		await expect(listZigTracks('https://next.plyr.fm/api', {}, fetcher)).rejects.toThrow(
			'invalid Zig track collection'
		);
	});
});
