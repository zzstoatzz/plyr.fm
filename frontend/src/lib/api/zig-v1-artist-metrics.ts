import type { Analytics } from '$lib/types';

interface ZigArtistMetrics {
	object: 'artist_metrics';
	artist_did: string;
	totals: {
		plays: number;
		tracks: number;
		duration_seconds: number;
	};
	top_track: {
		id: string;
		record: { uri: string; cid: string };
		title: string;
		play_count: number;
	} | null;
	sources: {
		catalog: 'verified_repo';
		duration: 'verified_repo';
		plays: 'application_metrics';
	};
	projection: { verification: 'verified_repo' };
}

export async function getZigArtistMetrics(
	baseUrl: string,
	identifier: string,
	fetcher: typeof fetch = fetch
): Promise<Analytics> {
	const response = await fetcher(
		`${baseUrl}/v1/artists/${encodeURIComponent(identifier)}/metrics`,
		{ headers: { accept: 'application/json' } }
	);
	if (!response.ok) throw new Error(`Zig artist metrics returned ${response.status}`);
	const value: unknown = await response.json();
	assertArtistMetrics(value, identifier);
	return {
		total_plays: value.totals.plays,
		total_items: value.totals.tracks,
		total_duration_seconds: value.totals.duration_seconds,
		top_item: value.top_track
			? {
					id: value.top_track.id,
					title: value.top_track.title,
					play_count: value.top_track.play_count
				}
			: null,
		top_liked: null,
		rank: null
	};
}

function assertArtistMetrics(
	value: unknown,
	identifier: string
): asserts value is ZigArtistMetrics {
	if (!isObject(value)) throw new TypeError('invalid Zig artist metrics');
	const totals = value.totals;
	const sources = value.sources;
	const projection = value.projection;
	if (
		value.object !== 'artist_metrics' ||
		typeof value.artist_did !== 'string' ||
		(identifier.startsWith('did:') && value.artist_did !== identifier) ||
		!isObject(totals) ||
		!isNonNegativeInteger(totals.plays) ||
		!isNonNegativeInteger(totals.tracks) ||
		!isNonNegativeInteger(totals.duration_seconds) ||
		!isObject(sources) ||
		sources.catalog !== 'verified_repo' ||
		sources.duration !== 'verified_repo' ||
		sources.plays !== 'application_metrics' ||
		!isObject(projection) ||
		projection.verification !== 'verified_repo'
	) {
		throw new TypeError('invalid Zig artist metrics');
	}
	if (value.top_track !== null) assertTopTrack(value.top_track, value.artist_did);
}

function assertTopTrack(value: unknown, artistDid: string): void {
	if (!isObject(value) || !isObject(value.record)) {
		throw new TypeError('invalid Zig artist metrics');
	}
	if (
		typeof value.id !== 'string' ||
		!value.id.startsWith('trk_') ||
		typeof value.title !== 'string' ||
		!isNonNegativeInteger(value.play_count) ||
		typeof value.record.uri !== 'string' ||
		!value.record.uri.startsWith(`at://${artistDid}/`) ||
		typeof value.record.cid !== 'string' ||
		value.record.cid.length === 0
	) {
		throw new TypeError('invalid Zig artist metrics');
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
