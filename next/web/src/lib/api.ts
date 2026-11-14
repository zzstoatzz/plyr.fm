import { createApi } from '$core/api';

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
