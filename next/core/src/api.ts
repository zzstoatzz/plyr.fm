// Canonical records are read-only here; anonymous play metrics are app-owned.
import { PlayDeliveryError, type PlayReceipt, type QualifiedPlay } from './play-outbox.ts';
import { uriFromId } from './record-ids.ts';
import { readableError } from './api-errors.ts';
import { parseTrackWaveform, type TrackWaveformBody } from './track-waveform.ts';

export interface Page<T> {
	object: 'list';
	data: T[];
	has_more: boolean;
	next_cursor?: string | null;
}

export interface Track {
	object: 'track';
	id: string;
	legacy_id?: number | null;
	record: { uri: string; cid: string | null; revision: string | null; collection: string; rkey: string };
	metadata: {
		title: string;
		artist_name?: string | null;
		description: string | null;
		album: string | null;
		duration_seconds: number | null;
		created_at: string;
		tags?: string[] | null;
	};
	artist: {
		did: string;
		profile: { handle: string; display_name: string; avatar_url: string | null; bio?: string | null };
	};
	media: { artwork?: { url: string } | null };
	access: { visibility: 'public' | 'unlisted' | 'supporters' | 'private'; download_policy?: string | null; gate?: { type: string } | null; space_uri?: string | null };
	metrics: { play_count: number; like_count: number };
	moderation?: { self_labels: string[]; operator_labels: string[]; account_labels?: string[] };
}

export interface Playback {
	object: 'playback';
	track_id: string;
	record: { uri: string; cid: string };
	availability: {
		/** `preparing`: verified, and its audio is still being copied to the streaming origin; ask again shortly */
		status: 'available' | 'preparing' | 'unavailable' | 'gated';
		/** gated audio: read it from the artist's space with a space credential */
		space?: { uri: string; record: string; gate: 'supporters' | 'signed-in' | string } | null;
		/** the audio blob the signed record points at, if any */
		artifact?: { cid: string; media_type: string; byte_length: number | null } | null;
		delivery?: { url: string; media_type: string } | null;
	};
}

export interface Artist {
	object: 'artist';
	did: string;
	handle: string;
	display_name: string;
	bio: string | null;
	avatar_url: string | null;
	support_url: string | null;
	/** where the artist sells each release; links only, see selling.ts */
	offers?: { subject: string; url: string; amount?: number | null; currency?: string | null }[];
	/** links the artist shows on their page; see artist-page.ts */
	links?: { url: string; label?: string | null }[];
	/** what sits behind the artist's page; null or missing is their photo, blurred */
	backdrop?: { kind: string; color?: string | null; image?: string | null } | null;
}

export interface NetworkArtist { did: string; handle: string; display_name: string; avatar_url: string | null; track_count: number }

export interface ArtistMetrics {
	object: 'artist_metrics';
	artist_did: string;
	totals: { plays: number; tracks: number; duration_seconds: number };
	top_track: { id: string; title: string; play_count: number } | null;
}

export type StatsRange = 'week' | 'month' | 'year' | 'all';

/** The stats page for one range. `series` is by day for week and month, by month for year and all. */
export interface StatsOverview {
	object: 'stats_overview';
	range: StatsRange;
	/** how many hours each bar of the series covers: 3, 6 or 24 */
	bucket_hours: number;
	/** when the first bar starts and the last one ends, ISO times aligned to UTC */
	start: string;
	end: string;
	/** all time: every counted play; otherwise the dated plays in the range */
	plays: number;
	/** the plays in range that carry a date: all of them, except all time */
	dated_plays: number;
	/** the same length of time just before; null for all time */
	previous_plays: number | null;
	uploads: number;
	/** all time, every range */
	likes: number;
	series: { start: string; plays: number; uploads: number }[];
	/** the ten most played in range, as record URIs */
	tracks: { uri: string; plays: number }[];
	/** up to 500 artists, most played in range first */
	artists: { did: string; plays: number; tracks: number }[];
}

export interface ListSummary {
	object: 'album' | 'playlist';
	id: string;
	record: { uri: string; cid: string; collection: string; rkey: string };
	metadata: { name: string | null; created_at: string; updated_at: string | null; cover_blob_cid?: string | null };
	owner: { did: string; profile: { handle: string; display_name: string; avatar_url?: string | null } | null };
	/** a cover: the first available member's artwork, or null */
	media?: { artwork?: { url: string } | null };
	metrics: { member_count: number; available_count: number; total_plays: number };
}

export interface ListDetail extends ListSummary {
	members: {
		position: number;
		subject: { uri: string; cid: string };
		availability: 'available' | 'unavailable';
		track: Track | null;
	}[];
}

export interface SearchHit {
	object: 'search_result';
	type: 'track' | 'artist' | 'album' | 'playlist';
	id: string;
	legacy_id?: number | null;
	record: { uri: string; cid: string };
	title: string;
	owner: { did: string; handle: string; display_name: string };
	image_url: string | null;
}

export interface ChartEntry {
	rank: number;
	period_like_count: number;
	all_time_like_count: number;
	track: Track;
}

export type AwaitStatus = 'indexed' | 'deleted' | 'absent' | 'rejected' | 'pending';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

async function request<T>(url: string, timeout: number, signal?: AbortSignal, init?: RequestInit): Promise<T> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (signal?.aborted) controller.abort();
	signal?.addEventListener('abort', abort, { once: true });
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		if (!response.ok) {
			let message: unknown;
			try { const body = await response.json(); message = body?.message ?? body?.error?.message; } catch {}
			throw new ApiError(response.status, readableError(response.status, message));
		}
		return await response.json() as T;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', abort);
	}
}

export interface TrackLike {
	record: { uri: string };
	actor: LikeActor;
}
export type LikeActor = { did: string; profile?: { handle?: string; display_name?: string; avatar_url?: string | null } | null };

/** A track's comments; `comments_enabled` is false when the artist hasn't opted in, and then `data` is empty. */
export interface TrackCommentPage extends Page<TrackComment> {
	comments_enabled?: boolean;
}

export interface TrackComment {
	record: { uri: string; cid: string; rkey: string };
	author: { did: string; handle: string | null; display_name: string | null; avatar_url: string | null };
	subject: { uri: string; cid: string };
	text: string;
	timestamp_ms: number;
	created_at: string;
	updated_at: string | null;
}

/** A track named by a numeric production id goes by `legacyId`; anything else by its record's AT-URI. */
function trackSubject(id: string): Record<string, string> {
	return /^[1-9][0-9]*$/.test(id) ? { legacyId: id } : { uri: uriFromId(id) };
}

/**
 * The appview's reads, as `{nsidPrefix}.unspecced.*` XRPC methods. Callers
 * still pass the `/v1` ids (`trk_…`, `alb_…`, `pls_…`); each is the record's
 * AT-URI, decoded here.
 */
export function createApi(origin: string, playListenerId: () => string, nsidPrefix = 'fm.plyr') {
	const xrpc = (name: string) => `/xrpc/${nsidPrefix}.unspecced.${name}`;
	async function get<T>(path: string, params?: Record<string, string | number | string[] | undefined>, signal?: AbortSignal): Promise<T> {
		const url = new URL(origin + path);
		for (const [key, value] of Object.entries(params ?? {})) {
			if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
			else if (value !== undefined) url.searchParams.set(key, String(value));
		}
		try {
			return await request<T>(url.toString(), 15_000, signal);
		} catch (error) {
			if (signal?.aborted || error instanceof ApiError) throw error;
			try {
				return await request<T>(url.toString(), 20_000, signal);
			} catch (error) {
				if (signal?.aborted || error instanceof ApiError) throw error;
				throw new ApiError(0, "couldn't reach plyr.fm, try again in a moment");
			}
		}
	}

	return {
		resolveArtists: (dids: string[], signal?: AbortSignal) => request<{ object: 'list'; data: NetworkArtist[] }>(origin + xrpc('resolveArtists'), 15_000, signal,
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dids }) }).then(page => page.data),
		/** The newest listed track from each of up to 500 artists, newest first. */
		latestTracks: (dids: string[], limit: number, signal?: AbortSignal) => request<{ object: 'list'; data: Track[] }>(origin + xrpc('resolveLatestTracks'), 15_000, signal,
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dids, limit }) }).then(page => page.data),
		resolveTracks: (ids: string[], signal?: AbortSignal) => request<{ object: 'list'; data: Track[]; missing: string[] }>(origin + xrpc('resolveTracks'), 15_000, signal,
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uris: ids.map(uriFromId) }) }),
		statsOverview: (range: StatsRange, signal?: AbortSignal) => get<StatsOverview>(xrpc('getStatsOverview'), { range }, signal),
		stats: (signal?: AbortSignal) => get<{ object: 'platform_stats'; tracks: number; artists: number; duration_seconds: number; plays: number; updated_at_ms: number }>(xrpc('getStats'), undefined, signal),
		/** the atlas map, rebuilt daily; its shape is core's atlas/types.ts */
		atlas: (signal?: AbortSignal) => get<unknown>(xrpc('getAtlas'), undefined, signal),
		recordPlay: async (play: QualifiedPlay): Promise<PlayReceipt> => {
			const url = new URL(origin + xrpc('recordPlay'));
			for (const [key, value] of Object.entries(trackSubject(play.trackId))) url.searchParams.set(key, value);
			url.searchParams.set('occurrence', play.occurrenceId);
			url.searchParams.set('listener', playListenerId());
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 15_000);
			try {
				const response = await fetch(url, { method: 'POST', credentials: 'include', keepalive: true, signal: controller.signal });
				if (!response.ok) throw new PlayDeliveryError(`play receipt failed (${response.status})`, response.status >= 500 || response.status === 429);
				const receipt: unknown = await response.json();
				if (!isPlayReceipt(receipt, play)) throw new PlayDeliveryError('invalid play receipt', true);
				return receipt;
			} finally {
				clearTimeout(timer);
			}
		},
		trackLikes: (id: string, cursor?: string) =>
			get<Page<TrackLike>>(xrpc('getTrackLikes'), { uri: uriFromId(id), limit: 30, cursor }),
		trackComments: (id: string, signal?: AbortSignal) =>
			get<TrackCommentPage>(xrpc('getTrackComments'), { uri: uriFromId(id) }, signal),
		tracks: ({ artist_did, hidden_tag, ...p }: { limit?: number; cursor?: string; artist_did?: string; tag?: string[]; hidden_tag?: string[] } = {}, signal?: AbortSignal) =>
			get<Page<Track>>(xrpc('listTracks'), { ...p, artistDid: artist_did, hiddenTag: hidden_tag }, signal),
		tags: (limit = 24, signal?: AbortSignal, cursor?: string) => get<Page<{ name: string; track_count: number; total_plays: number }>>(xrpc('getTags'), { limit, cursor }, signal),
		track: (id: string, options?: { fresh?: boolean }) => options?.fresh
			? request<Track>(`${origin}${xrpc('getTrack')}?${new URLSearchParams(trackSubject(id))}`, 15_000, undefined, { cache: 'no-store' })
			: get<Track>(xrpc('getTrack'), trackSubject(id)),
		playback: (id: string, options?: { fresh?: boolean }) => options?.fresh
			? request<Playback>(`${origin}${xrpc('getPlayback')}?${new URLSearchParams({ uri: uriFromId(id) })}`, 15_000, undefined, { cache: 'no-store' })
			: get<Playback>(xrpc('getPlayback'), { uri: uriFromId(id) }),
		/** null until the track's public audio has been measured */
		trackWaveform: (uri: string, signal?: AbortSignal) => get<TrackWaveformBody>(xrpc('getTrackWaveform'), { uri }, signal)
			.then(parseTrackWaveform, error => { if (error instanceof ApiError && error.status === 404) return null; throw error; }),
		artist: (didOrHandle: string, signal?: AbortSignal) => get<Artist>(xrpc('getArtist'), { actor: didOrHandle }, signal),
		artistMetrics: (did: string, signal?: AbortSignal) => get<ArtistMetrics>(xrpc('getArtistMetrics'), { actor: did }, signal),
		albums: (artist_did: string, p: { limit?: number; cursor?: string } = {}) => get<Page<ListSummary>>(xrpc('listAlbums'), { artistDid: artist_did, ...p }),
		album: (id: string) => get<ListDetail>(xrpc('getAlbum'), { uri: uriFromId(id) }),
		playlists: ({ owner_did, ...p }: { limit?: number; cursor?: string; owner_did?: string } = {}) =>
			get<Page<ListSummary>>(xrpc('listPlaylists'), { ...p, ownerDid: owner_did }),
		playlist: (id: string) => get<ListDetail>(xrpc('getPlaylist'), { uri: uriFromId(id) }),
		/** an actor's likes are public records, so the appview serves them without a session. */
		actorLikes: (did: string, p: { limit?: number; cursor?: string } = {}) =>
			get<Page<Track>>(xrpc('getActorLikes'), { actor: did, ...p }),
		search: (q: string, options: { limit?: number; types?: SearchHit['type']; signal?: AbortSignal } = {}) =>
			get<Page<SearchHit>>(xrpc('search'), { q, limit: options.limit, types: options.types }, options.signal),
		/** up to 50 tracks; the server has no cursor past that */
		chart: (period: 'day' | 'week' | 'month' | 'all_time' = 'week', limit?: number, signal?: AbortSignal) =>
			get<{ period: string; data: ChartEntry[] }>(xrpc('getTrackChart'), { period, limit }, signal),
		/** tracks that go with the seeds (record URIs), best first; never returns a seed or an excluded URI */
		suggestions: (seeds: string[], options: { exclude?: string[]; limit?: number; signal?: AbortSignal } = {}) =>
			get<{ object: 'track_suggestions'; data: Track[] }>(xrpc('getTrackSuggestions'), { seed: seeds, exclude: options.exclude, limit: options.limit }, options.signal),
		/** block (≤ timeout) until the appview has projected a write the client made on its PDS. */
		awaitRecord: (uri: string, cid?: string, timeout_ms = 8000) =>
			get<{ uri: string; status: AwaitStatus; cid?: string; reason?: string }>(xrpc('awaitRecord'), {
				uri,
				cid,
				timeoutMs: timeout_ms
			})
	};
}

function isPlayReceipt(value: unknown, play: QualifiedPlay): value is PlayReceipt {
	if (typeof value !== 'object' || value === null) return false;
	return 'object' in value && value.object === 'play_receipt' &&
		'occurrence' in value && value.occurrence === play.occurrenceId &&
		'track_id' in value && value.track_id === play.trackId &&
		'play_count' in value && typeof value.play_count === 'number' && Number.isSafeInteger(value.play_count) && value.play_count >= 0 &&
		'counted' in value && typeof value.counted === 'boolean' &&
		'record' in value && typeof value.record === 'object' && value.record !== null &&
		'uri' in value.record && typeof value.record.uri === 'string' &&
		'sources' in value && typeof value.sources === 'object' && value.sources !== null &&
		'metrics' in value.sources && value.sources.metrics === 'application_metrics' &&
		'dedup' in value.sources && value.sources.dedup === 'postgres_durable' &&
		'dedup' in value && typeof value.dedup === 'object' && value.dedup !== null &&
		'window_seconds' in value.dedup && typeof value.dedup.window_seconds === 'number' && Number.isFinite(value.dedup.window_seconds) &&
		'status' in value.dedup && (value.dedup.status === 'claimed' || value.dedup.status === 'duplicate' || value.dedup.status === 'suppressed');
}

export { albumIdFromUri, canonicalId, playlistIdFromUri, trackIdFromUri } from './record-ids.ts';
