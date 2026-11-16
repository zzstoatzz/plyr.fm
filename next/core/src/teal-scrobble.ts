import type { Track } from './api.ts';
import type { Did } from './auth-state.ts';
import type { QualifiedPlay } from './listening-session.ts';
import { createRecord, getRecord, repoOk, type RepoRpc } from './publishing/repo-rpc.ts';

export const TEAL_PLAY = 'fm.teal.feed.play';
export const TEAL_SCOPE = `repo:${TEAL_PLAY}?action=create`;

export function hasTealGrant(scope: string): boolean {
	return scope.split(' ').some(grant => {
		const [collection, query] = grant.split('?');
		if (collection !== `repo:${TEAL_PLAY}`) return false;
		return !query || new URLSearchParams(query).getAll('action').includes('create');
	});
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

export function tealPlay(track: Track, play: QualifiedPlay, playedAt: number, origin: string) {
	if (track.id !== play.trackId || track.access.visibility !== 'public' || track.access.gate || track.access.space_uri) return;
	const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
	const nonce = Number.parseInt(play.occurrenceId.slice(-4), 16) % 1000;
	let value = ((BigInt(playedAt) * 1000n + BigInt(nonce)) << 10n) | 1n;
	let rkey = '';
	for (let index = 0; index < 13; index++) {
		rkey = alphabet[Number(value & 31n)] + rkey;
		value >>= 5n;
	}
	const { title, album, duration_seconds, artist_name } = track.metadata;
	const { display_name, handle } = track.artist.profile;
	const record = {
		$type: TEAL_PLAY,
		trackName: tealLabel(title),
		artists: [{ artistName: tealLabel(artist_name || display_name || handle || track.artist.did) }],
		musicServiceUri: 'https://plyr.fm',
		submissionClientAgent: 'plyr.fm/next',
		playedTime: new Date(playedAt).toISOString(),
		originUri: origin,
		...(album ? { releaseName: tealLabel(album) } : {}),
		...(duration_seconds && duration_seconds >= 1 ? { duration: Math.floor(duration_seconds) } : {})
	};
	return { collection: TEAL_PLAY, rkey, record } as const;
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
