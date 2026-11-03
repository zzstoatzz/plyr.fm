// typed client for the zig appview's /v1 (read-only; no cookies, no sessions).
import { API_URL } from './config';

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
	access: { visibility: 'public' | 'unlisted' | 'supporters' };
	metrics: { play_count: number; like_count: number };
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
	owner: { did: string; profile: { handle: string; display_name: string } | null };
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

async function request(url: string, timeout: number) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		return await fetch(url, { signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
	const url = new URL(API_URL + path);
	for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
	// a scaled-to-zero API can take a few seconds to wake; retry once, and
	// never hang the page forever.
	let res: Response;
	try {
		res = await request(url.toString(), 15_000);
	} catch {
		try {
			res = await request(url.toString(), 20_000);
		} catch {
			throw new ApiError(0, "couldn't reach the plyr API, try again in a moment");
		}
	}
	if (!res.ok) {
		let message = res.statusText;
		try {
			message = (await res.json())?.error?.message ?? message;
		} catch {
			/* not json */
		}
		throw new ApiError(res.status, message);
	}
	return res.json() as Promise<T>;
}

export const api = {
	tracks: (p: { limit?: number; cursor?: string; artist_did?: string } = {}) => get<Page<Track>>('/v1/tracks', p),
	track: (id: string) => get<Track>(`/v1/tracks/${encodeURIComponent(id)}`),
	playback: (id: string) => get<Playback>(`/v1/tracks/${encodeURIComponent(id)}/playback`),
	artist: (didOrHandle: string) => get<Artist>(`/v1/artists/${encodeURIComponent(didOrHandle)}`),
	artistMetrics: (did: string) => get<ArtistMetrics>(`/v1/artists/${encodeURIComponent(did)}/metrics`),
	albums: (artist_did: string) => get<Page<ListSummary>>('/v1/albums', { artist_did }),
	album: (id: string) => get<ListDetail>(`/v1/albums/${encodeURIComponent(id)}`),
	playlists: (p: { limit?: number; cursor?: string; owner_did?: string } = {}) =>
		get<Page<ListSummary>>('/v1/playlists', p),
	playlist: (id: string) => get<ListDetail>(`/v1/playlists/${encodeURIComponent(id)}`),
	/** an actor's likes are public records, so the appview serves them without a session. */
	actorLikes: (did: string, p: { limit?: number; cursor?: string } = {}) =>
		get<Page<Track>>(`/v1/actors/${did}/likes`, p),
	search: (q: string) => get<Page<SearchHit>>('/v1/search', { q }),
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

function opaqueId(prefix: string, uri: string): string {
	const bytes = new TextEncoder().encode(uri);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return prefix + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** /v1 ids are a type prefix + base64url(at-uri), reversible by design. */
export const trackIdFromUri = (uri: string) => opaqueId('trk_', uri);
export const playlistIdFromUri = (uri: string) => opaqueId('pls_', uri);
