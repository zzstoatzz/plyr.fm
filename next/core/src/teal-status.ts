import { pdsEndpoint } from './identity.ts';

/** teal.fm's "now playing" record. teal dropped the `alpha` namespace; its older records still exist. */
const STATUS_COLLECTIONS = ['fm.teal.actor.status', 'fm.teal.alpha.actor.status'] as const;
/** the lexicon's default when a status has no expiry */
const DEFAULT_TTL = 10 * 60_000;
/** a status stays up a little past the track's end so a slow next-track write doesn't flicker the card */
const TRACK_GRACE = 30_000;

export interface ListeningNow {
	track: string;
	artists: string[];
	release?: string;
	/** seconds */
	duration?: number;
	startedAt: number;
	endsAt: number;
	/** a plyr track id or legacy id when the play came from plyr */
	plyrTrack?: string;
	/** any other https page for the play */
	link?: string;
}

const text = (value: unknown, max = 256) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
const time = (value: unknown) => {
	const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : undefined;
};
const PLYR_HOSTS = new Set(['plyr.fm', 'www.plyr.fm', 'next.plyr.fm']);

function origin(value: unknown): Pick<ListeningNow, 'plyrTrack' | 'link'> {
	const raw = text(value, 2048);
	if (!raw) return {};
	let url: URL;
	try { url = new URL(raw); } catch { return {}; }
	if (url.protocol !== 'https:') return {};
	const track = PLYR_HOSTS.has(url.hostname) ? /^\/track\/([^/]+)\/?$/.exec(url.pathname)?.[1] : undefined;
	if (track) return /^[A-Za-z0-9._~-]+$/.test(track) ? { plyrTrack: track } : {};
	return { link: url.href };
}

/** the status record as something to show, or null when it's malformed or no longer current. */
export function listeningNow(record: unknown, now: number): ListeningNow | null {
	if (!record || typeof record !== 'object') return null;
	const { time: recorded, expiry, item } = record as Record<string, unknown>;
	if (!item || typeof item !== 'object') return null;
	const play = item as Record<string, unknown>;
	const track = text(play.trackName);
	const artists = Array.isArray(play.artists)
		? play.artists.map(artist => text((artist as Record<string, unknown> | null)?.artistName)).filter(name => name !== undefined)
		: [];
	const legacyArtist = Array.isArray(play.artistNames) ? play.artistNames.map(name => text(name)).filter(name => name !== undefined) : [];
	const statusAt = time(recorded);
	if (!track || statusAt === undefined) return null;
	const startedAt = Math.min(time(play.playedTime) ?? statusAt, now);
	const duration = typeof play.duration === 'number' && Number.isFinite(play.duration) && play.duration >= 1 ? Math.floor(play.duration) : undefined;
	let endsAt = time(expiry) ?? statusAt + DEFAULT_TTL;
	if (duration) endsAt = Math.min(endsAt, startedAt + duration * 1000 + TRACK_GRACE);
	if (now >= endsAt) return null;
	const release = text(play.releaseName);
	return {
		track,
		artists: artists.length ? artists : legacyArtist,
		startedAt,
		endsAt,
		...(release ? { release } : {}),
		...(duration ? { duration } : {}),
		...origin(play.originUri)
	};
}

/** what `did` is listening to right now according to teal, read from their own PDS. never throws. */
export async function readListeningNow(did: string, { signal, now = Date.now }: { signal?: AbortSignal; now?: () => number } = {}): Promise<ListeningNow | null> {
	try {
		const pds = await pdsEndpoint(did);
		const found = await Promise.all(STATUS_COLLECTIONS.map(async collection => {
			const params = new URLSearchParams({ repo: did, collection, rkey: 'self' });
			const response = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${params}`, { signal }).catch(() => null);
			if (!response?.ok) return null;
			const body: unknown = await response.json().catch(() => null);
			return body && typeof body === 'object' && 'value' in body ? listeningNow(body.value, now()) : null;
		}));
		return found.filter(status => status !== null).sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
	} catch {
		return null;
	}
}
