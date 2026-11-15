import type { Did } from '@plyr/next-core/auth-state';

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
