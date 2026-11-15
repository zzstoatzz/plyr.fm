import type { Did } from '@plyr/next-core/auth-state';

let pendingStart: { host: string; key: string } | undefined;

export function newJamPath(host: string, track: string) {
	const key = crypto.randomUUID();
	pendingStart = { host, key };
	return jamRoomPath(host, key, track);
}

export function takeJamStart(room: { host: string; key: string }) {
	if (pendingStart?.host !== room.host || pendingStart.key !== room.key) return false;
	pendingStart = undefined;
	return true;
}

export function isJamDid(value: string): value is Did {
	return /^did:(plc|web):[^/?#~\s]+$/.test(value);
}

export function parseJamRoom(slug: string) {
	const [host, key, extra] = slug.split('~');
	return isJamDid(host) && /^[a-zA-Z0-9_-]{1,64}$/.test(key ?? '') && extra === undefined ? { host, key } : undefined;
}

export function jamRoomPath(host: string, key: string, track?: string) {
	return '/jam/' + encodeURIComponent(host + '~' + key) + (track ? '?track=' + encodeURIComponent(track) : '');
}
