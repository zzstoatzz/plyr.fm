import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser';
import { SCOPE_PARTS, SITE_URL } from './auth-config';
import { clearAuth, getAuth, scopeFor, setAuth } from './auth-state';

export { useAuth } from './auth-state';
export const authAvailable = true;

let client: Promise<BrowserOAuthClient> | undefined;
function oauthClient() {
	if (client) return client;
	const loopback = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
	const redirect = `${location.origin.replace('://localhost', '://127.0.0.1')}/oauth/callback`;
	const clientId = loopback
		? `http://localhost?redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(SCOPE_PARTS.join(' '))}`
		: `${SITE_URL}/oauth-client-metadata.json`;
	client = BrowserOAuthClient.load({
		clientId,
		allowHttp: loopback,
		handleResolver: 'https://public.api.bsky.app',
		onSessionDeleted: did => { if (getAuth().did === did) clearAuth(); }
	});
	client.catch(() => { client = undefined; });
	return client;
}

async function activate(session: OAuthSession) {
	const token = await session.getTokenInfo();
	setAuth(session.did, { handle: session.fetchHandler.bind(session) }, token.scope);
}

let initialization: Promise<void> | undefined;
export function restoreAuth(): Promise<void> {
	return initialization ??= initialize();
}

async function initialize() {
	if (typeof window === 'undefined') return;
	if (location.pathname.replace(/\/$/, '') === '/oauth/callback') {
		const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
		history.replaceState(history.state, '', location.pathname);
		try {
			const { session } = await (await oauthClient()).initCallback(params);
			await activate(session);
		} catch (error) {
			clearAuth(error instanceof Error ? error.message : 'Could not sign in', params.get('error') === 'invalid_scope');
		}
		return;
	}
	try {
		const restored = await (await oauthClient()).initRestore();
		if (restored) {
			await activate(restored.session);
			return;
		}
	} catch {
		/* A revoked or inaccessible session should leave a usable signed-out app. */
	}
	clearAuth();
}

export async function login(identifier: string, deviceOnly = false): Promise<void> {
	const handle = identifier.trim().replace(/^@/, '');
	await (await oauthClient()).signInRedirect(handle, { scope: await scopeFor(handle, deviceOnly) });
}

export async function logout() {
	const { did } = getAuth();
	clearAuth();
	if (did) await (await oauthClient()).revoke(did);
}
