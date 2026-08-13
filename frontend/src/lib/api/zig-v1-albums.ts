import type { AlbumResponse, ArtistAlbumSummary } from '$lib/types';
import { assertZigTrack, toFrontendTrack, type ZigTrack } from './zig-v1';

export interface ZigAlbumPage {
	object: 'list';
	data: ZigAlbumSummary[];
	has_more: boolean;
	next_cursor: string | null;
}

export interface ZigAlbumSummary {
	object: 'album';
	id: string;
	record: { uri: string; cid: string; collection: string; rkey: string };
	metadata: { name: string; created_at: string; updated_at: string | null };
	owner: {
		did: string;
		profile: { handle: string; display_name: string; avatar_url: string | null } | null;
	};
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

export interface ZigAlbumDetail extends ZigAlbumSummary {
	members: Array<{
		position: number;
		subject: { uri: string; cid: string };
		availability: 'available' | 'unavailable';
		track: ZigTrack | null;
	}>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function listZigAlbums(
	apiUrl: string,
	artistDid: string,
	options: { limit?: number; cursor?: string | null } = {},
	fetcher: Fetcher = fetch
): Promise<{ albums: ArtistAlbumSummary[]; next_cursor: string | null; has_more: boolean }> {
	const url = new URL(`${apiUrl}/v1/albums`);
	url.searchParams.set('artist_did', artistDid);
	url.searchParams.set('limit', String(options.limit ?? 20));
	if (options.cursor) url.searchParams.set('cursor', options.cursor);
	const response = await fetcher(url, { headers: { accept: 'application/json' } });
	if (!response.ok) throw new Error(`Zig album collection returned ${response.status}`);
	const page: unknown = await response.json();
	assertAlbumPage(page, artistDid);
	return {
		albums: page.data.map(toFrontendAlbumSummary),
		next_cursor: page.next_cursor,
		has_more: page.has_more
	};
}

export async function getZigAlbum(
	apiUrl: string,
	albumId: string,
	fetcher: Fetcher = fetch
): Promise<AlbumResponse | null> {
	assertOpaqueId(albumId);
	const response = await fetcher(`${apiUrl}/v1/albums/${encodeURIComponent(albumId)}`, {
		headers: { accept: 'application/json' }
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Zig album detail returned ${response.status}`);
	const value: unknown = await response.json();
	assertAlbumDetail(value);
	if (value.id !== albumId) throw new TypeError('Zig album detail changed resource identity');
	return toFrontendAlbum(value);
}

export function toFrontendAlbumSummary(value: ZigAlbumSummary): ArtistAlbumSummary {
	return {
		id: value.id,
		title: value.metadata.name,
		slug: value.id,
		track_count: value.metrics.member_count,
		total_plays: value.metrics.total_plays
	};
}

export function toFrontendAlbum(value: ZigAlbumDetail): AlbumResponse {
	const ownerHandle = value.owner.profile?.handle ?? value.owner.did;
	const ownerName =
		value.owner.profile?.display_name || value.owner.profile?.handle || value.owner.did;
	return {
		metadata: {
			...toFrontendAlbumSummary(value),
			artist: ownerName,
			artist_handle: ownerHandle,
			artist_did: value.owner.did,
			list_uri: value.record.uri
		},
		tracks: value.members.flatMap((member) =>
			member.availability === 'available' && member.track ? [toFrontendTrack(member.track)] : []
		),
		unavailable_track_count: value.metrics.member_count - value.metrics.available_count
	};
}

function assertAlbumPage(value: unknown, artistDid: string): asserts value is ZigAlbumPage {
	if (
		!isObject(value) ||
		value.object !== 'list' ||
		!Array.isArray(value.data) ||
		typeof value.has_more !== 'boolean' ||
		!(value.next_cursor === null || typeof value.next_cursor === 'string')
	) {
		throw new TypeError('invalid Zig album collection');
	}
	for (const album of value.data) {
		assertAlbumSummary(album);
		if (album.owner.did !== artistDid) {
			throw new TypeError('Zig album collection escaped artist scope');
		}
	}
}

function assertAlbumDetail(value: unknown): asserts value is ZigAlbumDetail {
	assertAlbumSummary(value);
	const members = (value as unknown as Record<string, unknown>).members;
	if (!Array.isArray(members) || members.length !== value.metrics.member_count) {
		throw new TypeError('invalid Zig album detail');
	}
	let available = 0;
	for (const [position, member] of members.entries()) {
		if (
			!isObject(member) ||
			member.position !== position ||
			!isObject(member.subject) ||
			typeof member.subject.uri !== 'string' ||
			typeof member.subject.cid !== 'string' ||
			!['available', 'unavailable'].includes(String(member.availability))
		) {
			throw new TypeError('invalid Zig album detail');
		}
		if (member.availability === 'available') {
			assertZigTrack(member.track);
			available += 1;
		} else if (member.track !== null) {
			throw new TypeError('invalid Zig album detail');
		}
	}
	if (available !== value.metrics.available_count) {
		throw new TypeError('invalid Zig album detail');
	}
}

function assertAlbumSummary(value: unknown): asserts value is ZigAlbumSummary {
	if (
		!isObject(value) ||
		value.object !== 'album' ||
		typeof value.id !== 'string' ||
		!value.id.startsWith('alb_') ||
		!isObject(value.record) ||
		typeof value.record.uri !== 'string' ||
		typeof value.record.cid !== 'string' ||
		typeof value.record.collection !== 'string' ||
		typeof value.record.rkey !== 'string' ||
		!isObject(value.metadata) ||
		typeof value.metadata.name !== 'string' ||
		typeof value.metadata.created_at !== 'string' ||
		!(value.metadata.updated_at === null || typeof value.metadata.updated_at === 'string') ||
		!isObject(value.owner) ||
		typeof value.owner.did !== 'string' ||
		!(value.owner.profile === null || isOwnerProfile(value.owner.profile)) ||
		value.record.uri !==
			`at://${value.owner.did}/${value.record.collection}/${value.record.rkey}` ||
		!isObject(value.metrics) ||
		!isNonNegativeInteger(value.metrics.member_count) ||
		!isNonNegativeInteger(value.metrics.available_count) ||
		value.metrics.available_count > value.metrics.member_count ||
		!isNonNegativeInteger(value.metrics.total_plays) ||
		!isObject(value.sources) ||
		value.sources.record !== 'verified_repo' ||
		value.sources.membership !== 'verified_repo' ||
		value.sources.owner_identity !== 'verified_repo' ||
		!['legacy_projection', 'mixed', 'derived'].includes(String(value.sources.owner_profile)) ||
		!['application_metrics', 'derived'].includes(String(value.sources.metrics)) ||
		!['verified_repo', 'current_pds'].includes(String(value.sources.account_availability)) ||
		!isObject(value.projection) ||
		value.projection.verification !== 'verified_repo' ||
		typeof value.projection.commit_cid !== 'string' ||
		typeof value.projection.commit_rev !== 'string' ||
		!isNonNegativeInteger(value.projection.indexed_at_us) ||
		'presentation' in value
	) {
		throw new TypeError('invalid Zig album resource');
	}
}

function isOwnerProfile(value: unknown): boolean {
	return (
		isObject(value) &&
		typeof value.handle === 'string' &&
		typeof value.display_name === 'string' &&
		(value.avatar_url === null || typeof value.avatar_url === 'string')
	);
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isInteger(value) && Number(value) >= 0;
}

function assertOpaqueId(value: string): void {
	if (value.length === 0 || value.includes('/') || value.includes('?') || value.includes('#')) {
		throw new TypeError('invalid album identifier');
	}
}

function isObject(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null;
}
