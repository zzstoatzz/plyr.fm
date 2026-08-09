import type { Track } from '$lib/types';

export interface ZigTrackPage {
	object: 'list';
	data: ZigTrack[];
	has_more: boolean;
	next_cursor: string | null;
}

export interface ZigTrack {
	object: 'track';
	id: string;
	record: {
		uri: string;
		cid: string | null;
		revision: string | null;
		collection: string;
		rkey: string;
	};
	metadata: {
		title: string;
		artist_name: string | null;
		description: string | null;
		album: string | null;
		duration_seconds: number | null;
		created_at: string;
	};
	artist: {
		did: string;
		profile: {
			handle: string;
			display_name: string;
			avatar_url: string | null;
			bio: string | null;
		};
	};
	media: {
		origins: Array<{
			url: string;
			media_type: string;
			artifact_cid: string | null;
			source: string;
		}>;
	};
	access: {
		visibility: 'public' | 'unlisted' | 'supporters';
		in_discovery: boolean;
		gate: { type: string } | null;
	};
	moderation: {
		self_labels: string[];
		operator_labels: string[];
	};
	metrics: { play_count: number };
	projection: { verification: 'verified_repo' };
}

export interface ZigPlayback {
	object: 'playback';
	track_id: string;
	availability: {
		status: 'available' | 'unavailable';
		delivery: {
			url: string;
			media_type: string;
			source: string;
			integrity: string;
		} | null;
	};
}

interface ListOptions {
	limit?: number;
	cursor?: string | null;
	artistDid?: string | null;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function listZigTracks(
	apiUrl: string,
	options: ListOptions = {},
	fetcher: Fetcher = fetch
): Promise<{ tracks: Track[]; next_cursor: string | null; has_more: boolean }> {
	const url = new URL(`${apiUrl}/v1/tracks`);
	url.searchParams.set('limit', String(options.limit ?? 20));
	if (options.cursor) url.searchParams.set('cursor', options.cursor);
	if (options.artistDid) url.searchParams.set('artist_did', options.artistDid);
	const response = await fetcher(url, { headers: { accept: 'application/json' } });
	if (!response.ok) throw new Error(`Zig track collection returned ${response.status}`);
	const page: unknown = await response.json();
	assertTrackPage(page);
	return {
		tracks: page.data.map(toFrontendTrack),
		next_cursor: page.next_cursor,
		has_more: page.has_more
	};
}

export async function getZigTrack(
	apiUrl: string,
	trackId: string,
	fetcher: Fetcher = fetch
): Promise<Track | null> {
	assertOpaqueId(trackId, 'track');
	const response = await fetcher(`${apiUrl}/v1/tracks/${encodeURIComponent(trackId)}`, {
		headers: { accept: 'application/json' }
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Zig track detail returned ${response.status}`);
	const value: unknown = await response.json();
	assertTrack(value);
	if (value.id !== trackId) throw new TypeError('Zig track detail changed resource identity');
	return toFrontendTrack(value);
}

export async function getZigPlayback(
	apiUrl: string,
	trackId: string,
	fetcher: Fetcher = fetch
): Promise<ZigPlayback> {
	assertOpaqueId(trackId, 'track');
	const response = await fetcher(`${apiUrl}/v1/tracks/${encodeURIComponent(trackId)}/playback`, {
		headers: { accept: 'application/json' }
	});
	if (!response.ok) throw new Error(`Zig playback capability returned ${response.status}`);
	const value: unknown = await response.json();
	if (
		!isObject(value) ||
		value.object !== 'playback' ||
		value.track_id !== trackId ||
		!isObject(value.availability) ||
		!['available', 'unavailable'].includes(String(value.availability.status))
	) {
		throw new TypeError('invalid Zig playback capability');
	}
	return value as unknown as ZigPlayback;
}

export function toFrontendTrack(value: ZigTrack): Track {
	const origin = value.media.origins[0];
	return {
		id: value.id,
		title: value.metadata.title,
		artist:
			value.artist.profile.display_name ||
			value.metadata.artist_name ||
			value.artist.profile.handle,
		album: null,
		file_id: value.id,
		file_type: origin?.media_type ?? 'application/octet-stream',
		artist_handle: value.artist.profile.handle,
		artist_avatar_url: value.artist.profile.avatar_url ?? undefined,
		artist_did: value.artist.did,
		r2_url: origin?.url,
		atproto_record_uri: value.record.uri,
		atproto_record_cid: value.record.cid ?? undefined,
		play_count: value.metrics.play_count,
		like_count: 0,
		comment_count: 0,
		created_at: value.metadata.created_at,
		is_liked: false,
		self_labels: value.moderation.self_labels,
		operator_labels: value.moderation.operator_labels,
		labels: [...value.moderation.self_labels, ...value.moderation.operator_labels],
		support_gate: value.access.gate,
		gated: false,
		description: value.metadata.description,
		unlisted: !value.access.in_discovery
	};
}

function assertTrackPage(value: unknown): asserts value is ZigTrackPage {
	if (
		!isObject(value) ||
		value.object !== 'list' ||
		!Array.isArray(value.data) ||
		typeof value.has_more !== 'boolean' ||
		!(value.next_cursor === null || typeof value.next_cursor === 'string')
	) {
		throw new TypeError('invalid Zig track collection');
	}
	for (const track of value.data) assertTrack(track);
}

function assertTrack(value: unknown): asserts value is ZigTrack {
	if (
		!isObject(value) ||
		value.object !== 'track' ||
		typeof value.id !== 'string' ||
		!isObject(value.record) ||
		typeof value.record.uri !== 'string' ||
		!isObject(value.metadata) ||
		typeof value.metadata.title !== 'string' ||
		!isObject(value.artist) ||
		!isObject(value.artist.profile) ||
		typeof value.artist.did !== 'string' ||
		typeof value.artist.profile.handle !== 'string' ||
		!isObject(value.media) ||
		!Array.isArray(value.media.origins) ||
		!isObject(value.metrics) ||
		!Number.isInteger(value.metrics.play_count) ||
		!isObject(value.projection) ||
		value.projection.verification !== 'verified_repo'
	) {
		throw new TypeError('invalid Zig track resource');
	}
}

function assertOpaqueId(value: string, resource: string): void {
	if (value.length === 0 || value.includes('/') || value.includes('?') || value.includes('#')) {
		throw new TypeError(`invalid ${resource} identifier`);
	}
}

function isObject(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null;
}
