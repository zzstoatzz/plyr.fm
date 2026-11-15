import { createApi } from '@plyr/next-core/api';

export const apiOrigin = (import.meta.env.PUBLIC_API_URL || 'https://api.next.plyr.fm').replace(/\/$/, '');
const listenerKey = 'plyr-next:anonymous-play-listener';
let listener: string | undefined;

function listenerId(): string {
	if (listener) return listener;
	try {
		const stored = localStorage.getItem(listenerKey);
		if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) {
			return listener = stored;
		}
	} catch {}
	listener = crypto.randomUUID();
	try { localStorage.setItem(listenerKey, listener); } catch {}
	return listener;
}

export const api = createApi(apiOrigin, listenerId);

export async function accountAvatar(did: string, signal: AbortSignal): Promise<string | undefined> {
	const artist = await api.artist(did, signal).catch(() => undefined);
	if (artist?.avatar_url) return artist.avatar_url;
	if (signal.aborted) return;
	const request = new URL('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile');
	request.searchParams.set('actor', did);
	const response = await fetch(request, { signal });
	const profile: { avatar?: unknown } | undefined = response.ok ? await response.json() : undefined;
	return typeof profile?.avatar === 'string' ? profile.avatar : undefined;
}
