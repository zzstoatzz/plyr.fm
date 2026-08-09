import type { SearchResponse, SearchResult } from '$lib/search.svelte';

export type ZigSearchKind = 'track' | 'artist' | 'album' | 'playlist';

interface ZigSearchPage {
	object: 'list';
	data: ZigSearchHit[];
	query: string;
	counts: {
		tracks: number;
		artists: number;
		albums: number;
		playlists: number;
	};
}

interface ZigSearchHit {
	object: 'search_result';
	type: ZigSearchKind;
	id: string;
	record: { uri: string; cid: string };
	title: string;
	owner: { did: string; handle: string; display_name: string };
	image_url: string | null;
	metrics: { play_count: number | null; member_count: number | null };
	match: {
		kind: 'exact' | 'prefix' | 'substring' | 'fuzzy';
		field: 'title' | 'handle' | 'display_name' | 'name';
	};
	sources: {
		record: 'verified_repo';
		title: string;
		owner_identity: 'verified_repo';
		owner_handle: string;
		owner_display_name: string;
		image: string;
		metrics: string;
		account_availability: string;
	};
	projection: { verification: 'verified_repo'; indexed_at_us: number };
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const FRONTEND_KINDS: ZigSearchKind[] = ['track', 'artist', 'album'];

export async function searchZigCatalog(
	apiUrl: string,
	query: string,
	options: { limit?: number; types?: ZigSearchKind[] } = {},
	fetcher: Fetcher = fetch
): Promise<SearchResponse> {
	const types = options.types ?? FRONTEND_KINDS;
	if (types.length === 0 || new Set(types).size !== types.length) {
		throw new TypeError('invalid Zig search type selection');
	}
	const limit = options.limit ?? 10;
	if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
		throw new TypeError('invalid Zig search limit');
	}

	const url = new URL(`${apiUrl}/v1/search`);
	url.searchParams.set('q', query);
	url.searchParams.set('types', types.join(','));
	url.searchParams.set('limit', String(limit));
	const response = await fetcher(url, { headers: { accept: 'application/json' } });
	if (!response.ok) throw new Error(`Zig search returned ${response.status}`);
	const value: unknown = await response.json();
	assertSearchPage(value, query, new Set(types), limit);

	return {
		results: value.data.map(toSearchResult),
		counts: {
			tracks: value.counts.tracks,
			artists: value.counts.artists,
			albums: value.counts.albums,
			tags: 0,
			playlists: value.counts.playlists
		}
	};
}

function toSearchResult(hit: ZigSearchHit): SearchResult {
	switch (hit.type) {
		case 'track':
			return {
				type: 'track',
				id: hit.id,
				title: hit.title,
				artist_handle: hit.owner.handle,
				artist_display_name: hit.owner.display_name,
				image_url: hit.image_url
			};
		case 'artist':
			return {
				type: 'artist',
				did: hit.owner.did,
				handle: hit.owner.handle,
				display_name: hit.title,
				avatar_url: hit.image_url
			};
		case 'album':
			return {
				type: 'album',
				id: hit.id,
				title: hit.title,
				slug: hit.id,
				artist_handle: hit.owner.handle,
				artist_display_name: hit.owner.display_name,
				image_url: hit.image_url
			};
		case 'playlist':
			return {
				type: 'playlist',
				id: hit.id,
				name: hit.title,
				owner_handle: hit.owner.handle,
				owner_display_name: hit.owner.display_name,
				image_url: hit.image_url,
				track_count: hit.metrics.member_count ?? 0
			};
	}
}

function assertSearchPage(
	value: unknown,
	query: string,
	types: Set<ZigSearchKind>,
	limit: number
): asserts value is ZigSearchPage {
	if (
		!isObject(value) ||
		value.object !== 'list' ||
		value.query !== query.trim() ||
		!Array.isArray(value.data) ||
		value.data.length > limit ||
		!isObject(value.counts)
	) {
		throw new TypeError('invalid Zig search page');
	}
	for (const key of ['tracks', 'artists', 'albums', 'playlists']) {
		if (!isNonNegativeInteger(value.counts[key])) throw new TypeError('invalid Zig search counts');
	}
	for (const hit of value.data) {
		assertSearchHit(hit);
		if (!types.has(hit.type)) throw new TypeError('Zig search escaped requested type scope');
	}
	const actual = { tracks: 0, artists: 0, albums: 0, playlists: 0 };
	for (const hit of value.data) actual[`${hit.type}s` as keyof typeof actual] += 1;
	for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
		if (value.counts[key] !== actual[key]) throw new TypeError('invalid Zig search counts');
	}
}

function assertSearchHit(value: unknown): asserts value is ZigSearchHit {
	if (
		!isObject(value) ||
		value.object !== 'search_result' ||
		!['track', 'artist', 'album', 'playlist'].includes(String(value.type)) ||
		typeof value.id !== 'string' ||
		typeof value.title !== 'string' ||
		!isObject(value.record) ||
		typeof value.record.uri !== 'string' ||
		typeof value.record.cid !== 'string' ||
		!isObject(value.owner) ||
		typeof value.owner.did !== 'string' ||
		typeof value.owner.handle !== 'string' ||
		typeof value.owner.display_name !== 'string' ||
		!(value.image_url === null || typeof value.image_url === 'string') ||
		!isObject(value.metrics) ||
		!isNullableNonNegativeInteger(value.metrics.play_count) ||
		!isNullableNonNegativeInteger(value.metrics.member_count) ||
		!isObject(value.match) ||
		!['exact', 'prefix', 'substring', 'fuzzy'].includes(String(value.match.kind)) ||
		!['title', 'handle', 'display_name', 'name'].includes(String(value.match.field)) ||
		!isObject(value.sources) ||
		value.sources.record !== 'verified_repo' ||
		value.sources.owner_identity !== 'verified_repo' ||
		!['verified_repo', 'legacy_local'].includes(String(value.sources.title)) ||
		value.sources.owner_handle !== 'legacy_projection' ||
		!['legacy_projection', 'legacy_local'].includes(String(value.sources.owner_display_name)) ||
		!['authored_profile', 'legacy_projection', 'derived'].includes(String(value.sources.image)) ||
		!['application_metrics', 'derived'].includes(String(value.sources.metrics)) ||
		!['verified_repo', 'current_pds'].includes(String(value.sources.account_availability)) ||
		!isObject(value.projection) ||
		value.projection.verification !== 'verified_repo' ||
		!isNonNegativeInteger(value.projection.indexed_at_us) ||
		'relevance' in value ||
		'score' in value
	) {
		throw new TypeError('invalid Zig search result');
	}
	const kind = value.type as ZigSearchKind;
	const expectedPrefix = { track: 'trk_', artist: 'did:', album: 'alb_', playlist: 'pls_' }[kind];
	if (
		!value.id.startsWith(expectedPrefix) ||
		!value.record.uri.startsWith(`at://${value.owner.did}/`)
	) {
		throw new TypeError('invalid Zig search identity');
	}
	if (kind === 'artist' && value.id !== value.owner.did) {
		throw new TypeError('invalid Zig search identity');
	}
	if (
		kind === 'track' &&
		(value.metrics.play_count === null || value.metrics.member_count !== null)
	) {
		throw new TypeError('invalid Zig search metrics');
	}
	if (
		kind === 'artist' &&
		(value.metrics.play_count !== null || value.metrics.member_count !== null)
	) {
		throw new TypeError('invalid Zig search metrics');
	}
	if (
		(kind === 'album' || kind === 'playlist') &&
		(value.metrics.play_count !== null || value.metrics.member_count === null)
	) {
		throw new TypeError('invalid Zig search metrics');
	}
}

function isNullableNonNegativeInteger(value: unknown): boolean {
	return value === null || isNonNegativeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return Number.isInteger(value) && Number(value) >= 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
