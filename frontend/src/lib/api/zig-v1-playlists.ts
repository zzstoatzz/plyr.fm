import type { PlaylistWithTracks } from '$lib/types';
import { assertZigTrack, toFrontendTrack, type ZigTrack } from './zig-v1';

export interface ZigPlaylistDetail {
	object: 'playlist';
	id: string;
	record: { uri: string; cid: string; collection: string; rkey: string };
	metadata: { name: string | null; created_at: string; updated_at: string | null };
	owner: {
		did: string;
		profile: { handle: string; display_name: string; avatar_url: string | null } | null;
	};
	members: Array<{
		position: number;
		subject: { uri: string; cid: string };
		availability: 'available' | 'unavailable';
		track: ZigTrack | null;
	}>;
	metrics: { member_count: number; available_count: number; total_plays: number };
	sources: {
		record: 'verified_repo';
		membership: 'verified_repo';
		owner_identity: 'verified_repo';
		owner_profile: 'legacy_projection' | 'mixed' | 'derived';
		metrics: 'application_metrics' | 'derived';
		account_availability: 'verified_repo' | 'current_pds';
	};
	projection: {
		verification: 'verified_repo';
		commit_cid: string;
		commit_rev: string;
		indexed_at_us: number;
	};
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function getZigPlaylist(
	apiUrl: string,
	playlistId: string,
	fetcher: Fetcher = fetch
): Promise<PlaylistWithTracks | null> {
	assertOpaqueId(playlistId);
	const response = await fetcher(`${apiUrl}/v1/playlists/${encodeURIComponent(playlistId)}`, {
		headers: { accept: 'application/json' }
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Zig playlist detail returned ${response.status}`);
	const value: unknown = await response.json();
	assertPlaylistDetail(value);
	if (value.id !== playlistId) {
		throw new TypeError('Zig playlist detail changed resource identity');
	}
	return toFrontendPlaylist(value);
}

export function toFrontendPlaylist(value: ZigPlaylistDetail): PlaylistWithTracks {
	return {
		id: value.id,
		name: value.metadata.name ?? 'playlist',
		owner_did: value.owner.did,
		owner_handle: value.owner.profile?.handle ?? value.owner.did,
		track_count: value.metrics.member_count,
		show_on_profile: false,
		atproto_record_uri: value.record.uri,
		is_private: false,
		created_at: value.metadata.created_at,
		preview_thumbnails: [],
		tracks: value.members.flatMap((member) =>
			member.availability === 'available' && member.track ? [toFrontendTrack(member.track)] : []
		)
	};
}

function assertPlaylistDetail(value: unknown): asserts value is ZigPlaylistDetail {
	if (
		!isObject(value) ||
		value.object !== 'playlist' ||
		typeof value.id !== 'string' ||
		!value.id.startsWith('pls_') ||
		!isObject(value.record) ||
		typeof value.record.uri !== 'string' ||
		typeof value.record.cid !== 'string' ||
		typeof value.record.collection !== 'string' ||
		typeof value.record.rkey !== 'string' ||
		!isObject(value.metadata) ||
		!(value.metadata.name === null || typeof value.metadata.name === 'string') ||
		typeof value.metadata.created_at !== 'string' ||
		!(value.metadata.updated_at === null || typeof value.metadata.updated_at === 'string') ||
		!isObject(value.owner) ||
		typeof value.owner.did !== 'string' ||
		!(value.owner.profile === null || isOwnerProfile(value.owner.profile)) ||
		value.record.uri !==
			`at://${value.owner.did}/${value.record.collection}/${value.record.rkey}` ||
		!Array.isArray(value.members) ||
		!isMetrics(value.metrics) ||
		value.members.length !== value.metrics.member_count ||
		!isSources(value.sources) ||
		!isProjection(value.projection) ||
		'presentation' in value ||
		'is_private' in value
	) {
		throw new TypeError('invalid Zig playlist resource');
	}

	let available = 0;
	for (const [position, member] of value.members.entries()) {
		if (
			!isObject(member) ||
			member.position !== position ||
			!isObject(member.subject) ||
			typeof member.subject.uri !== 'string' ||
			typeof member.subject.cid !== 'string' ||
			!['available', 'unavailable'].includes(String(member.availability))
		) {
			throw new TypeError('invalid Zig playlist member');
		}
		if (member.availability === 'available') {
			assertZigTrack(member.track);
			if (
				member.track.record.uri !== member.subject.uri ||
				member.track.record.cid !== member.subject.cid
			) {
				throw new TypeError('Zig playlist member changed its signed subject');
			}
			available += 1;
		} else if (member.track !== null) {
			throw new TypeError('invalid Zig playlist member');
		}
	}
	if (available !== value.metrics.available_count) {
		throw new TypeError('invalid Zig playlist metrics');
	}
}

function isMetrics(value: unknown): value is ZigPlaylistDetail['metrics'] {
	return (
		isObject(value) &&
		isNonNegativeInteger(value.member_count) &&
		isNonNegativeInteger(value.available_count) &&
		value.available_count <= value.member_count &&
		isNonNegativeInteger(value.total_plays)
	);
}

function isSources(value: unknown): value is ZigPlaylistDetail['sources'] {
	return (
		isObject(value) &&
		value.record === 'verified_repo' &&
		value.membership === 'verified_repo' &&
		value.owner_identity === 'verified_repo' &&
		['legacy_projection', 'mixed', 'derived'].includes(String(value.owner_profile)) &&
		['application_metrics', 'derived'].includes(String(value.metrics)) &&
		['verified_repo', 'current_pds'].includes(String(value.account_availability))
	);
}

function isProjection(value: unknown): value is ZigPlaylistDetail['projection'] {
	return (
		isObject(value) &&
		value.verification === 'verified_repo' &&
		typeof value.commit_cid === 'string' &&
		typeof value.commit_rev === 'string' &&
		isNonNegativeInteger(value.indexed_at_us)
	);
}

function isOwnerProfile(value: unknown): boolean {
	return (
		isObject(value) &&
		typeof value.handle === 'string' &&
		typeof value.display_name === 'string' &&
		(value.avatar_url === null || typeof value.avatar_url === 'string')
	);
}

function assertOpaqueId(value: string): void {
	if (value.length === 0 || value.includes('/') || value.includes('?') || value.includes('#')) {
		throw new TypeError('invalid playlist identifier');
	}
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isInteger(value) && Number(value) >= 0;
}

function isObject(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null;
}
