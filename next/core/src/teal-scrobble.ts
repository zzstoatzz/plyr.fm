import type { Track } from './api.ts';
import type { Did } from './auth-state.ts';
import type { QualifiedPlay } from './listening-session.ts';
import { createRecord, getRecord, putRecord, repoOk, type RepoRpc } from './publishing/repo-rpc.ts';

export const TEAL_PLAY = 'fm.teal.feed.play';
export const TEAL_STATUS = 'fm.teal.actor.status';
/** asked for only when someone turns on teal.fm in settings: log plays, and set "now playing" while they listen. */
export const TEAL_SCOPE_PARTS = [`repo:${TEAL_PLAY}?action=create`, `repo:${TEAL_STATUS}?action=create&action=update`] as const;

function grants(scope: string, collection: string, actions: string[]) {
	return scope.split(' ').some(grant => {
		const [target, query] = grant.split('?');
		if (target !== `repo:${collection}`) return false;
		const allowed = new URLSearchParams(query).getAll('action');
		return !query || actions.every(action => allowed.includes(action));
	});
}

/** enough to log plays; sessions from before now-playing hold only this */
export function hasTealPlayGrant(scope: string): boolean {
	return grants(scope, TEAL_PLAY, ['create']);
}

/** everything the teal.fm switch asks for */
export function hasTealGrant(scope: string): boolean {
	return hasTealPlayGrant(scope) && grants(scope, TEAL_STATUS, ['create', 'update']);
}

function tealLabel(value: string) {
	const encoder = new TextEncoder();
	let bytes = 0;
	let label = '';
	for (const character of value) {
		bytes += encoder.encode(character).length;
		if (bytes > 256) break;
		label += character;
	}
	return label;
}

const shareable = (track: Track) => track.access.visibility === 'public' && !track.access.gate && !track.access.space_uri;

function playView(track: Track, playedAt: number, origin: string) {
	const { title, album, duration_seconds, artist_name } = track.metadata;
	const { display_name, handle } = track.artist.profile;
	return {
		trackName: tealLabel(title),
		artists: [{ artistName: tealLabel(artist_name || display_name || handle || track.artist.did) }],
		musicServiceUri: 'https://plyr.fm',
		submissionClientAgent: 'plyr.fm/next',
		playedTime: new Date(playedAt).toISOString(),
		originUri: origin,
		...(album ? { releaseName: tealLabel(album) } : {}),
		...(duration_seconds && duration_seconds >= 1 ? { duration: Math.floor(duration_seconds) } : {})
	};
}

export function tealPlay(track: Track, play: QualifiedPlay, playedAt: number, origin: string) {
	if (track.id !== play.trackId || !shareable(track)) return;
	const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
	const nonce = Number.parseInt(play.occurrenceId.slice(-4), 16) % 1000;
	let value = ((BigInt(playedAt) * 1000n + BigInt(nonce)) << 10n) | 1n;
	let rkey = '';
	for (let index = 0; index < 13; index++) {
		rkey = alphabet[Number(value & 31n)] + rkey;
		value >>= 5n;
	}
	return { collection: TEAL_PLAY, rkey, record: { $type: TEAL_PLAY, ...playView(track, playedAt, origin) } } as const;
}

export async function writeTealPlay(rpc: RepoRpc, repo: Did, play: NonNullable<ReturnType<typeof tealPlay>>) {
	const { collection, rkey, record } = play;
	const result = await createRecord(rpc, { input: { repo, collection, rkey, record } });
	if (!result.ok && (result.status === 400 || result.status === 409)) {
		const existing = await getRecord(rpc, { params: { repo, collection, rkey } });
		if (existing.ok && existing.data.value.playedTime === record.playedTime && existing.data.value.originUri === record.originUri) return;
	}
	repoOk(result);
}

/** a status lasts this long past the track's end, and this long outright when the length is unknown (the lexicon default) */
const STATUS_GRACE = 30_000;
const STATUS_TTL = 10 * 60_000;

/** "now playing" for a public track that began `startedAt`; `expiresAt` defaults to when the track would end. */
export function tealStatus(track: Track, startedAt: number, now: number, origin: string, expiresAt?: number) {
	if (!shareable(track)) return;
	const duration = track.metadata.duration_seconds;
	const end = expiresAt ?? (duration && duration >= 1 ? startedAt + duration * 1000 + STATUS_GRACE : now + STATUS_TTL);
	return {
		$type: TEAL_STATUS,
		time: new Date(now).toISOString(),
		expiry: new Date(Math.max(now, end)).toISOString(),
		item: playView(track, startedAt, origin)
	};
}
export type TealStatus = NonNullable<ReturnType<typeof tealStatus>>;

export function writeTealStatus(rpc: RepoRpc, repo: Did, record: TealStatus) {
	return repoOk(putRecord(rpc, { input: { repo, collection: TEAL_STATUS, rkey: 'self', record } }));
}

type Shown = { track: Track; startedAt: number };
type Observed = { track: Track | null; playing: boolean; positionSeconds: number };

/**
 * keeps the listener's teal "now playing" in step with the player: set when a track plays,
 * re-set after a seek, ended early on pause. waits for the player to settle before writing,
 * so skipping through a queue writes once.
 */
export function tealStatusWriter({ write, origin, settle = 2000, now = Date.now }: {
	/** resolves false when it chose not to write (no consent yet, signed out), which is retried later */
	write: (record: TealStatus) => Promise<boolean>;
	origin: (track: Track) => string;
	settle?: number;
	now?: () => number;
}) {
	let latest: Observed = { track: null, playing: false, positionSeconds: 0 };
	let shown: Shown | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let writing = false;
	let retryAt = 0;
	let generation = 0;
	let backingOff = false;

	function wanted(): Shown | null {
		const { track, playing, positionSeconds } = latest;
		return track && playing && shareable(track) ? { track, startedAt: now() - Math.max(0, positionSeconds) * 1000 } : null;
	}
	function stale() {
		const want = wanted();
		if (!want || !shown) return !!want !== !!shown;
		return want.track.id !== shown.track.id || Math.abs(want.startedAt - shown.startedAt) > 5000;
	}
	async function flush() {
		timer = undefined;
		if (writing || !stale()) return;
		writing = true;
		const want = wanted();
		const previous = shown;
		const current = generation;
		let written = true;
		try {
			const at = now();
			const record = want
				? tealStatus(want.track, want.startedAt, at, origin(want.track))
				: previous && tealStatus(previous.track, previous.startedAt, at, origin(previous.track), at);
			shown = want;
			if (record) written = await write(record);
		} catch {
			written = false;
		} finally {
			writing = false;
			if (current === generation) {
				if (!written) {
					shown = previous;
					retryAt = now() + 30_000;
				}
				if (stale()) schedule(Math.max(settle, retryAt - now()));
			}
		}
	}
	function schedule(delay = settle) {
		clearTimeout(timer);
		backingOff = delay > settle;
		timer = setTimeout(() => void flush(), delay);
	}
	return {
		observe(next: Observed) {
			latest = next;
			if (stale()) { if ((!timer || backingOff) && now() >= retryAt) schedule(); }
			else { clearTimeout(timer); timer = undefined; }
		},
		/** forget what was shown, e.g. after the account changes; the old status runs out on its own */
		reset() {
			clearTimeout(timer);
			timer = undefined;
			shown = null;
			retryAt = 0;
			generation++;
			latest = { track: null, playing: false, positionSeconds: 0 };
		}
	};
}
