import type { Artist, Track } from '$lib/types';
import type { LikerData } from '$lib/tooltip-cache.svelte';

export interface ZigArtist {
	object: 'artist';
	did: string;
	handle: string;
	display_name: string;
	bio: string | null;
	avatar_url: string | null;
	show_liked_on_profile: boolean;
	support_url: string | null;
	created_at: string;
	updated_at: string;
	record: {
		uri: string;
		cid: string;
		revision: string;
		collection: string;
		rkey: 'self';
	};
	sources: {
		did: 'verified_repo';
		handle: 'legacy_projection';
		display_name: 'legacy_local';
		profile: 'verified_repo';
		public_preferences: 'legacy_local';
		account_availability: 'verified_repo' | 'current_pds';
	};
	projection: {
		indexed_at: string | null;
		verification: 'verified_repo';
	};
}

export interface ZigTrackPage {
	object: 'list';
	data: ZigTrack[];
	has_more: boolean;
	next_cursor: string | null;
}

export type ZigTrackChartPeriod = 'all_time' | 'month' | 'week' | 'day';

export interface ZigTrackChart {
	object: 'track_chart';
	period: ZigTrackChartPeriod;
	data: Array<{
		rank: number;
		period_like_count: number;
		all_time_like_count: number;
		track: ZigTrack;
	}>;
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
		artwork: {
			url: string;
			source: 'verified_repo' | 'legacy_projection';
		} | null;
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
	metrics: { play_count: number; like_count: number };
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

export interface ZigPlayReceipt {
	object: 'play_receipt';
	track_id: string;
	record: { uri: string };
	play_count: number;
	counted: boolean;
	dedup: {
		status: 'claimed' | 'duplicate' | 'unavailable';
		window_seconds: number;
	};
	sources: { metrics: 'application_metrics'; dedup: 'redis_ephemeral' };
}

interface ZigLikePage {
	object: 'list';
	data: Array<{
		object: 'like';
		record: { uri: string; cid: string };
		actor: {
			did: string;
			profile: { handle: string; display_name: string; avatar_url: string | null } | null;
		};
		subject: { uri: string; cid: string };
		created_at: string;
		sources: {
			record: 'verified_repo';
			subject: 'verified_repo';
			actor_identity: 'verified_repo';
			account_availability: 'verified_repo' | 'current_pds';
		};
		projection: { verification: 'verified_repo' };
	}>;
	has_more: boolean;
	next_cursor: string | null;
}

interface ListOptions {
	limit?: number;
	cursor?: string | null;
	artistDid?: string | null;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function getZigArtist(
	apiUrl: string,
	identifier: string,
	fetcher: Fetcher = fetch
): Promise<Artist | null> {
	assertOpaqueId(identifier, 'artist');
	const response = await fetcher(`${apiUrl}/v1/artists/${encodeURIComponent(identifier)}`, {
		headers: { accept: 'application/json' }
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Zig artist detail returned ${response.status}`);
	const value: unknown = await response.json();
	assertArtist(value);
	if (identifier.startsWith('did:') && value.did !== identifier) {
		throw new TypeError('Zig artist detail changed canonical identity');
	}
	if (!identifier.startsWith('did:') && value.handle.toLowerCase() !== identifier.toLowerCase()) {
		throw new TypeError('Zig artist detail changed handle alias');
	}
	return toFrontendArtist(value);
}

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

export async function listZigTrackChart(
	apiUrl: string,
	options: { limit?: number; period?: ZigTrackChartPeriod } = {},
	fetcher: Fetcher = fetch
): Promise<ZigTrackChart> {
	const url = new URL(`${apiUrl}/v1/charts/tracks`);
	if (options.limit !== undefined) url.searchParams.set('limit', String(options.limit));
	if (options.period !== undefined) url.searchParams.set('period', options.period);
	const response = await fetcher(url.toString(), {
		credentials: 'include',
		headers: { accept: 'application/json' }
	});
	if (!response.ok) throw new Error(`Zig track chart returned ${response.status}`);
	const value: unknown = await response.json();
	assertTrackChart(value);
	return value;
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
	assertZigTrack(value);
	if (value.id !== trackId) throw new TypeError('Zig track detail changed resource identity');
	return toFrontendTrack(value);
}

export async function listZigTrackLikers(
	apiUrl: string,
	trackId: string,
	options: { limit?: number; cursor?: string | null } = {},
	fetcher: Fetcher = fetch
): Promise<{ users: LikerData[]; has_more: boolean; next_cursor: string | null }> {
	assertOpaqueId(trackId, 'track');
	const url = new URL(`${apiUrl}/v1/tracks/${encodeURIComponent(trackId)}/likes`);
	url.searchParams.set('limit', String(options.limit ?? 100));
	if (options.cursor) url.searchParams.set('cursor', options.cursor);
	const response = await fetcher(url, {
		credentials: 'include',
		headers: { accept: 'application/json' }
	});
	if (!response.ok) throw new Error(`Zig track likes returned ${response.status}`);
	const value: unknown = await response.json();
	assertLikePage(value);
	const seen = new Set<string>();
	const users: LikerData[] = [];
	for (const item of value.data) {
		if (seen.has(item.actor.did)) continue;
		seen.add(item.actor.did);
		users.push({
			did: item.actor.did,
			handle: item.actor.profile?.handle ?? item.actor.did,
			display_name: item.actor.profile?.display_name ?? null,
			avatar_url: item.actor.profile?.avatar_url ?? null,
			liked_at: item.created_at
		});
	}
	return { users, has_more: value.has_more, next_cursor: value.next_cursor };
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

export async function recordZigPlay(
	apiUrl: string,
	trackId: string,
	ref: string | null = null,
	fetcher: Fetcher = fetch
): Promise<ZigPlayReceipt> {
	assertOpaqueId(trackId, 'track');
	const url = new URL(`${apiUrl}/v1/tracks/${encodeURIComponent(trackId)}/plays`);
	if (ref !== null) {
		if (!/^[A-Za-z0-9_-]{8}$/.test(ref)) throw new TypeError('invalid share reference');
		url.searchParams.set('ref', ref);
	}
	const response = await fetcher(url, {
		method: 'POST',
		credentials: 'include',
		headers: { accept: 'application/json' }
	});
	if (!response.ok) throw new Error(`Zig play recording returned ${response.status}`);
	const value: unknown = await response.json();
	assertPlayReceipt(value, trackId);
	return value;
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
		like_count: value.metrics.like_count,
		comment_count: 0,
		created_at: value.metadata.created_at,
		image_url: value.media.artwork?.url,
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

export function toFrontendArtist(value: ZigArtist): Artist {
	return {
		did: value.did,
		handle: value.handle,
		display_name: value.display_name,
		avatar_url: value.avatar_url ?? undefined,
		bio: value.bio ?? undefined,
		show_liked_on_profile: value.show_liked_on_profile,
		support_url: value.support_url ?? undefined
	};
}

function assertArtist(value: unknown): asserts value is ZigArtist {
	if (
		!isObject(value) ||
		value.object !== 'artist' ||
		typeof value.did !== 'string' ||
		typeof value.handle !== 'string' ||
		typeof value.display_name !== 'string' ||
		!(value.bio === null || typeof value.bio === 'string') ||
		!(value.avatar_url === null || typeof value.avatar_url === 'string') ||
		typeof value.show_liked_on_profile !== 'boolean' ||
		!(value.support_url === null || typeof value.support_url === 'string') ||
		typeof value.created_at !== 'string' ||
		typeof value.updated_at !== 'string' ||
		!isObject(value.record) ||
		typeof value.record.uri !== 'string' ||
		typeof value.record.cid !== 'string' ||
		typeof value.record.revision !== 'string' ||
		typeof value.record.collection !== 'string' ||
		value.record.rkey !== 'self' ||
		value.record.uri !== `at://${value.did}/${value.record.collection}/self` ||
		!isObject(value.sources) ||
		value.sources.did !== 'verified_repo' ||
		value.sources.handle !== 'legacy_projection' ||
		value.sources.display_name !== 'legacy_local' ||
		value.sources.profile !== 'verified_repo' ||
		value.sources.public_preferences !== 'legacy_local' ||
		!['verified_repo', 'current_pds'].includes(String(value.sources.account_availability)) ||
		!isObject(value.projection) ||
		!(value.projection.indexed_at === null || typeof value.projection.indexed_at === 'string') ||
		value.projection.verification !== 'verified_repo'
	) {
		throw new TypeError('invalid Zig artist resource');
	}
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
	for (const track of value.data) assertZigTrack(track);
}

function assertTrackChart(value: unknown): asserts value is ZigTrackChart {
	if (!isObject(value) || value.object !== 'track_chart')
		throw new Error('invalid Zig track chart');
	if (
		!['all_time', 'month', 'week', 'day'].includes(String(value.period)) ||
		!Array.isArray(value.data)
	) {
		throw new Error('invalid Zig track chart');
	}
	for (const rawEntry of value.data) {
		if (!isObject(rawEntry)) throw new Error('invalid Zig track chart entry');
		const rank = rawEntry.rank;
		const periodCount = rawEntry.period_like_count;
		const allTimeCount = rawEntry.all_time_like_count;
		if (
			!Number.isInteger(rank) ||
			Number(rank) < 1 ||
			!Number.isInteger(periodCount) ||
			Number(periodCount) < 1 ||
			!Number.isInteger(allTimeCount) ||
			Number(allTimeCount) < Number(periodCount)
		) {
			throw new Error('invalid Zig track chart counts');
		}
		assertZigTrack(rawEntry.track);
	}
}

function assertLikePage(value: unknown): asserts value is ZigLikePage {
	if (
		!isObject(value) ||
		value.object !== 'list' ||
		!Array.isArray(value.data) ||
		typeof value.has_more !== 'boolean' ||
		!(value.next_cursor === null || typeof value.next_cursor === 'string')
	) {
		throw new TypeError('invalid Zig track likes');
	}
	for (const item of value.data) {
		if (
			!isObject(item) ||
			item.object !== 'like' ||
			!isObject(item.record) ||
			typeof item.record.uri !== 'string' ||
			typeof item.record.cid !== 'string' ||
			!isObject(item.actor) ||
			typeof item.actor.did !== 'string' ||
			!(item.actor.profile === null || isLikerProfile(item.actor.profile)) ||
			!isObject(item.subject) ||
			typeof item.subject.uri !== 'string' ||
			typeof item.subject.cid !== 'string' ||
			typeof item.created_at !== 'string' ||
			!isObject(item.sources) ||
			item.sources.record !== 'verified_repo' ||
			item.sources.subject !== 'verified_repo' ||
			item.sources.actor_identity !== 'verified_repo' ||
			!['verified_repo', 'current_pds'].includes(String(item.sources.account_availability)) ||
			!isObject(item.projection) ||
			item.projection.verification !== 'verified_repo'
		) {
			throw new TypeError('invalid Zig track like');
		}
	}
}

function isLikerProfile(value: unknown): boolean {
	return (
		isObject(value) &&
		typeof value.handle === 'string' &&
		typeof value.display_name === 'string' &&
		(value.avatar_url === null || typeof value.avatar_url === 'string')
	);
}

export function assertZigTrack(value: unknown): asserts value is ZigTrack {
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
		!(
			value.media.artwork === null ||
			(isObject(value.media.artwork) &&
				typeof value.media.artwork.url === 'string' &&
				['verified_repo', 'legacy_projection'].includes(String(value.media.artwork.source)))
		) ||
		!isObject(value.metrics) ||
		!Number.isInteger(value.metrics.play_count) ||
		Number(value.metrics.play_count) < 0 ||
		!Number.isInteger(value.metrics.like_count) ||
		Number(value.metrics.like_count) < 0 ||
		!isObject(value.projection) ||
		value.projection.verification !== 'verified_repo'
	) {
		throw new TypeError('invalid Zig track resource');
	}
}

function assertPlayReceipt(value: unknown, trackId: string): asserts value is ZigPlayReceipt {
	if (
		!isObject(value) ||
		value.object !== 'play_receipt' ||
		value.track_id !== trackId ||
		!isObject(value.record) ||
		typeof value.record.uri !== 'string' ||
		!value.record.uri.startsWith('at://') ||
		!Number.isInteger(value.play_count) ||
		Number(value.play_count) < 0 ||
		typeof value.counted !== 'boolean' ||
		!isObject(value.dedup) ||
		!['claimed', 'duplicate', 'unavailable'].includes(String(value.dedup.status)) ||
		!Number.isInteger(value.dedup.window_seconds) ||
		Number(value.dedup.window_seconds) < 30 ||
		Number(value.dedup.window_seconds) > 3600 ||
		!isObject(value.sources) ||
		value.sources.metrics !== 'application_metrics' ||
		value.sources.dedup !== 'redis_ephemeral'
	) {
		throw new TypeError('invalid Zig play receipt');
	}
	if (value.counted === (value.dedup.status === 'duplicate')) {
		throw new TypeError('invalid Zig play receipt');
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
