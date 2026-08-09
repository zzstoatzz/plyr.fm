/** The Pages transport boundary is same-origin in browsers and stable in tests. */
export const API_ORIGIN = typeof location === 'undefined' ? 'https://next.plyr.fm' : location.origin;

/** @typedef {{uri: string, cid: string | null, revision: string | null, collection: string, rkey: string}} RecordRef */
/** @typedef {{handle: string, display_name: string, avatar_url: string | null, bio?: string | null}} ArtistProfile */
/** @typedef {{did: string, profile: ArtistProfile}} TrackArtist */
/** @typedef {{url: string, media_type: string, artifact_cid: string | null, source: string}} MediaOrigin */
/** @typedef {{visibility: string, in_discovery: boolean, gate: {type: string} | null}} TrackAccess */
/** @typedef {{object: 'track', id: string, record: RecordRef, metadata: {title: string, artist_name: string | null, description: string | null, album: string | null, duration_seconds: number | null, created_at: string}, artist: TrackArtist, media: {origins: MediaOrigin[]}, access: TrackAccess, metrics: {play_count: number}, projection: {verification: string}}} Track */
/** @typedef {{object: 'list', data: Track[], has_more: boolean, next_cursor: string | null}} TrackPage */
/** @typedef {{object: 'artist', did: string, handle: string, display_name: string, avatar_url: string | null, bio: string | null}} Artist */
/** @typedef {{object: 'playback', track_id: string, availability: {status: 'available' | 'unavailable', delivery: {url: string, media_type: string, source: string, integrity: string} | null}}} Playback */
/** @typedef {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} Fetcher */

export class ApiError extends Error {
	/** @param {number} status @param {string} path */
	constructor(status, path) {
		super(`Zig API returned ${status} for ${path}`);
		this.name = 'ApiError';
		this.status = status;
		this.path = path;
	}
}

/** @param {string} path @param {Fetcher} fetcher */
async function getJson(path, fetcher = fetch) {
	const response = await fetcher(new URL(`/api${path}`, API_ORIGIN), {
		headers: { accept: 'application/json' }
	});
	if (!response.ok) throw new ApiError(response.status, path);
	return response.json();
}

/**
 * @param {{limit?: number, cursor?: string | null, artistDid?: string | null}} [options]
 * @param {Fetcher} [fetcher]
 * @returns {Promise<TrackPage>}
 */
export async function listTracks(options = {}, fetcher = fetch) {
	const query = new URLSearchParams();
	query.set('limit', String(options.limit ?? 20));
	if (options.cursor) query.set('cursor', options.cursor);
	if (options.artistDid) query.set('artist_did', options.artistDid);
	const data = await getJson(`/v1/tracks?${query}`, fetcher);
	assertTrackPage(data);
	return data;
}

/** @param {string} identifier @param {Fetcher} [fetcher] @returns {Promise<Artist>} */
export async function getArtist(identifier, fetcher = fetch) {
	const data = await getJson(`/v1/artists/${encodeIdentifier(identifier)}`, fetcher);
	if (
		!isObject(data) ||
		data.object !== 'artist' ||
		typeof data.did !== 'string' ||
		typeof data.handle !== 'string' ||
		typeof data.display_name !== 'string'
	) {
		throw new TypeError('invalid artist response');
	}
	return /** @type {Artist} */ (data);
}

/**
 * Zig routes on the raw path and DIDs use literal colons. Preserve those legal
 * separators while still preventing an identifier from changing route shape.
 * @param {string} identifier
 */
function encodeIdentifier(identifier) {
	if (identifier.length === 0 || identifier.includes('/') || identifier.includes('?') || identifier.includes('#')) {
		throw new TypeError('invalid artist identifier');
	}
	return encodeURIComponent(identifier).replaceAll('%3A', ':');
}

/** @param {string} trackId @param {Fetcher} [fetcher] @returns {Promise<Playback>} */
export async function getPlayback(trackId, fetcher = fetch) {
	const data = await getJson(`/v1/tracks/${encodeURIComponent(trackId)}/playback`, fetcher);
	if (!isObject(data) || data.object !== 'playback' || data.track_id !== trackId || !isObject(data.availability)) {
		throw new TypeError('invalid playback response');
	}
	return /** @type {Playback} */ (data);
}

/** @param {unknown} value */
function assertTrackPage(value) {
	if (!isObject(value) || value.object !== 'list' || !Array.isArray(value.data) || typeof value.has_more !== 'boolean') {
		throw new TypeError('invalid track collection response');
	}
	for (const item of value.data) {
		if (!isObject(item) || item.object !== 'track' || typeof item.id !== 'string' || !isObject(item.metadata) || typeof item.metadata.title !== 'string') {
			throw new TypeError('invalid track in collection response');
		}
	}
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
	return typeof value === 'object' && value !== null;
}
