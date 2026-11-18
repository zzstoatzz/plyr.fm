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

export async function accountIdentity(did: string, signal: AbortSignal): Promise<{ avatar?: string; name?: string }> {
	const artist = await api.artist(did, signal).catch(() => undefined);
	const name = artist?.display_name?.trim() || undefined;
	if (artist?.avatar_url || signal.aborted) return { avatar: artist?.avatar_url ?? undefined, name };
	const request = new URL('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile');
	request.searchParams.set('actor', did);
	const response = await fetch(request, { signal });
	const profile: { avatar?: unknown; displayName?: unknown } | undefined = response.ok ? await response.json() : undefined;
	return {
		avatar: typeof profile?.avatar === 'string' ? profile.avatar : undefined,
		name: name ?? (typeof profile?.displayName === 'string' && profile.displayName.trim() ? profile.displayName.trim() : undefined)
	};
}
