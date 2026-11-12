// Canonical records are read-only here; anonymous play metrics are app-owned.
import { API_URL } from './config';
import { PlayDeliveryError, type PlayReceipt, type QualifiedPlay } from './play-outbox';
import { playListenerId } from './play-listener';

export interface Page<T> {
	object: 'list';
	data: T[];
	has_more: boolean;
	next_cursor?: string | null;
}

export interface Track {
	object: 'track';
	id: string;
	record: { uri: string; cid: string | null; revision: string | null; collection: string; rkey: string };
	metadata: {
		title: string;
		artist_name?: string | null;
		description: string | null;
		album: string | null;
		duration_seconds: number | null;
		created_at: string;
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
		status: 'available' | 'unavailable' | 'gated';
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
}

export interface ArtistMetrics {
	object: 'artist_metrics';
	artist_did: string;
	totals: { plays: number; tracks: number; duration_seconds: number };
	top_track: { id: string; title: string; play_count: number } | null;
}

export interface ListSummary {
	object: 'album' | 'playlist';
	id: string;
	record: { uri: string; cid: string; collection: string; rkey: string };
	metadata: { name: string | null; created_at: string; updated_at: string | null };
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
			let message = response.statusText;
			try { message = (await response.json())?.error?.message ?? message; } catch {}
			throw new ApiError(response.status, message);
		}
		return await response.json() as T;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', abort);
	}
}

async function get<T>(path: string, params?: Record<string, string | number | string[] | undefined>, signal?: AbortSignal): Promise<T> {
	const url = new URL(API_URL + path);
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
			throw new ApiError(0, "couldn't reach the plyr API, try again in a moment");
		}
	}
}

interface TrackLike {
	record: { uri: string };
	actor: { did: string; profile?: { handle?: string; display_name?: string; avatar_url?: string | null } | null };
}

export const api = {
  resolveTracks: (ids: string[], signal?: AbortSignal) => request<{ object: 'list'; data: Track[]; missing: string[] }>(API_URL + '/v1/tracks/resolve', 15_000, signal,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) }),
  stats: () => get<{ object: 'platform_stats'; tracks: number; artists: number; duration_seconds: number; plays: number; updated_at_ms: number }>('/v1/stats'),
	recordPlay: async (play: QualifiedPlay): Promise<PlayReceipt> => {
		const url = new URL(`${API_URL}/v1/tracks/${encodeURIComponent(play.trackId)}/plays`);
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
		get<Page<TrackLike>>(`/v1/tracks/${encodeURIComponent(id)}/likes`, { limit: 30, cursor }),
	tracks: (p: { limit?: number; cursor?: string; artist_did?: string; tag?: string[]; hidden_tag?: string[] } = {}, signal?: AbortSignal) => get<Page<Track>>('/v1/tracks', p, signal),
	track: (id: string, options?: { fresh?: boolean }) => options?.fresh
		? request<Track>(`${API_URL}/v1/tracks/${encodeURIComponent(id)}`, 15_000, undefined, { cache: 'no-store' })
		: get<Track>(`/v1/tracks/${encodeURIComponent(id)}`),
	playback: (id: string, options?: { fresh?: boolean }) => options?.fresh
		? request<Playback>(`${API_URL}/v1/tracks/${encodeURIComponent(id)}/playback`, 15_000, undefined, { cache: 'no-store' })
		: get<Playback>(`/v1/tracks/${encodeURIComponent(id)}/playback`),
	artist: (didOrHandle: string) => get<Artist>(`/v1/artists/${encodeURIComponent(didOrHandle)}`),
	artistMetrics: (did: string) => get<ArtistMetrics>(`/v1/artists/${encodeURIComponent(did)}/metrics`),
	albums: (artist_did: string, p: { limit?: number; cursor?: string } = {}) => get<Page<ListSummary>>('/v1/albums', { artist_did, ...p }),
	album: (id: string) => get<ListDetail>(`/v1/albums/${encodeURIComponent(id)}`),
	playlists: (p: { limit?: number; cursor?: string; owner_did?: string } = {}) =>
		get<Page<ListSummary>>('/v1/playlists', p),
	playlist: (id: string) => get<ListDetail>(`/v1/playlists/${encodeURIComponent(id)}`),
	/** an actor's likes are public records, so the appview serves them without a session. */
	actorLikes: (did: string, p: { limit?: number; cursor?: string } = {}) =>
		get<Page<Track>>(`/v1/actors/${did}/likes`, p),
	search: (q: string, options: { limit?: number; types?: SearchHit['type']; signal?: AbortSignal } = {}) =>
		get<Page<SearchHit>>('/v1/search', { q, limit: options.limit, types: options.types }, options.signal),
	chart: (period: 'day' | 'week' | 'month' | 'all_time' = 'week') =>
		get<{ period: string; data: ChartEntry[] }>('/v1/charts/tracks', { period }),
	/** block (≤ timeout) until the appview has projected a write the client made on its PDS. */
	awaitRecord: (uri: string, cid?: string, timeout_ms = 8000) =>
		get<{ uri: string; status: AwaitStatus; cid?: string; reason?: string }>('/v1/records/await', {
			uri,
			cid,
			timeout_ms
		})
};

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

function opaqueId(prefix: string, uri: string): string {
	const bytes = new TextEncoder().encode(uri);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return prefix + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** /v1 ids are a type prefix + base64url(at-uri), reversible by design. */
export const trackIdFromUri = (uri: string) => opaqueId('trk_', uri);
export const playlistIdFromUri = (uri: string) => opaqueId('pls_', uri);

export const albumIdFromUri = (uri: string) => opaqueId('alb_', uri);
