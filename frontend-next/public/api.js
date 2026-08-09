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
/** @typedef {{object: 'playlist', id: string, record: RecordRef, metadata: {name: string | null, created_at: string, updated_at: string | null}, owner: {did: string, profile: ArtistProfile | null}, metrics: {member_count: number, available_count: number, total_plays: number}, projection: {verification: 'verified_repo'}}} PlaylistSummary */
/** @typedef {{position: number, subject: {uri: string, cid: string}, availability: 'available' | 'unavailable', track: Track | null}} PlaylistMember */
/** @typedef {PlaylistSummary & {members: PlaylistMember[]}} Playlist */
/** @typedef {{object: 'list', data: PlaylistSummary[], has_more: boolean, next_cursor: string | null}} PlaylistPage */
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

/**
 * @param {{limit?: number, cursor?: string | null, ownerDid?: string | null}} [options]
 * @param {Fetcher} [fetcher]
 * @returns {Promise<PlaylistPage>}
 */
export async function listPlaylists(options = {}, fetcher = fetch) {
	const query = new URLSearchParams();
	query.set('limit', String(options.limit ?? 20));
	if (options.cursor) query.set('cursor', options.cursor);
	if (options.ownerDid) query.set('owner_did', options.ownerDid);
	const data = await getJson(`/v1/playlists?${query}`, fetcher);
	assertCollectionPage(data, 'playlist', assertPlaylistSummary);
	return /** @type {PlaylistPage} */ (data);
}

/** @param {string} playlistId @param {Fetcher} [fetcher] @returns {Promise<Playlist>} */
export async function getPlaylist(playlistId, fetcher = fetch) {
	const data = await getJson(`/v1/playlists/${encodeOpaqueId(playlistId, 'playlist')}`, fetcher);
	assertPlaylistSummary(data);
	if (!isObject(data) || data.id !== playlistId || !Array.isArray(data.members) || data.metrics.member_count !== data.members.length) {
		throw new TypeError('invalid playlist response');
	}
	for (const [position, member] of data.members.entries()) {
		assertPlaylistMember(member, position);
	}
	return /** @type {Playlist} */ (data);
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
	const data = await getJson(`/v1/tracks/${encodeOpaqueId(trackId, 'track')}/playback`, fetcher);
	if (!isObject(data) || data.object !== 'playback' || data.track_id !== trackId || !isObject(data.availability)) {
		throw new TypeError('invalid playback response');
	}
	return /** @type {Playback} */ (data);
}

/** @param {string} identifier @param {string} resource */
function encodeOpaqueId(identifier, resource) {
	if (identifier.length === 0 || identifier.includes('/') || identifier.includes('?') || identifier.includes('#')) {
		throw new TypeError(`invalid ${resource} identifier`);
	}
	return encodeURIComponent(identifier);
}

/** @param {unknown} value */
function assertTrackPage(value) {
	assertCollectionPage(value, 'track', assertTrack);
}

/** @param {unknown} value */
function assertTrack(value) {
	if (!isObject(value) || value.object !== 'track' || typeof value.id !== 'string' || !isObject(value.record) || !isObject(value.metadata) || typeof value.metadata.title !== 'string') {
		throw new TypeError('invalid track response');
	}
}

/** @param {unknown} value */
function assertPlaylistSummary(value) {
	if (
		!isObject(value) ||
		value.object !== 'playlist' ||
		typeof value.id !== 'string' ||
		!isObject(value.record) ||
		typeof value.record.uri !== 'string' ||
		typeof value.record.cid !== 'string' ||
		!isObject(value.metadata) ||
		!(value.metadata.name === null || typeof value.metadata.name === 'string') ||
		typeof value.metadata.created_at !== 'string' ||
		!isObject(value.owner) ||
		typeof value.owner.did !== 'string' ||
		!isObject(value.metrics) ||
		!Number.isInteger(value.metrics.member_count) ||
		!Number.isInteger(value.metrics.available_count) ||
		value.metrics.member_count < 0 ||
		value.metrics.available_count < 0 ||
		value.metrics.available_count > value.metrics.member_count ||
		!isObject(value.projection) ||
		value.projection.verification !== 'verified_repo'
	) {
		throw new TypeError('invalid playlist response');
	}
}

/** @param {unknown} value @param {number} position */
function assertPlaylistMember(value, position) {
	if (!isObject(value) || value.position !== position || !isObject(value.subject) || typeof value.subject.uri !== 'string' || typeof value.subject.cid !== 'string') {
		throw new TypeError('invalid playlist member response');
	}
	if (value.availability === 'available') {
		assertTrack(value.track);
		if (!isObject(value.track) || value.track.record.uri !== value.subject.uri || value.track.record.cid !== value.subject.cid) {
			throw new TypeError('invalid playlist member response');
		}
	} else if (value.availability !== 'unavailable' || value.track !== null) {
		throw new TypeError('invalid playlist member response');
	}
}

/** @param {unknown} value @param {string} object @param {(item: unknown) => void} assertItem */
function assertCollectionPage(value, object, assertItem) {
	if (!isObject(value) || value.object !== 'list' || !Array.isArray(value.data) || typeof value.has_more !== 'boolean' || !(value.next_cursor === null || typeof value.next_cursor === 'string')) {
		throw new TypeError(`invalid ${object} collection response`);
	}
	for (const item of value.data) assertItem(item);
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
	return typeof value === 'object' && value !== null;
}
