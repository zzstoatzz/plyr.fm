import { Client } from '@atcute/client';
import type { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser';
import { createAuthState } from '@plyr/next-core/auth-state';
import { hasTealGrant, TEAL_SCOPE } from '@plyr/next-core/teal-scrobble';
import { setPrefs } from './prefs.svelte';
import { returnPath } from '@plyr/next-core/return-path';
import { authConfig } from './auth-config';
import { completeQueueLogin, prepareQueueLogin } from './storage/queue-login';

const { SITE_URL, SCOPE_PARTS } = authConfig;
const tealUpgradeKey = 'plyr-next:teal-upgrade';
let grantedScope = '';
export function canScrobble() { return hasTealGrant(grantedScope); }
export const auth = createAuthState(authConfig, handler => new Client({ handler }));

let client: Promise<BrowserOAuthClient> | undefined;
function oauthClient() {
	if (client) return client;
	const loopback = location.hostname === '127.0.0.1';
	const redirect = `${location.origin}/oauth/callback`;
	const clientId = loopback
		? `http://localhost?redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent([...SCOPE_PARTS, TEAL_SCOPE].join(' '))}`
		: `${SITE_URL}/oauth-client-metadata.json`;
	client = import('@atproto/oauth-client-browser').then(({ BrowserOAuthClient }) => BrowserOAuthClient.load({
		clientId,
		allowHttp: loopback,
		handleResolver: 'https://public.api.bsky.app',
		onSessionDeleted: did => { if (auth.getAuth().did === did) auth.clearAuth(); }
	}));
	void client.catch(() => { client = undefined; });
	return client;
}

async function activate(session: OAuthSession) {
	const token = await session.getTokenInfo();
	grantedScope = token.scope;
	auth.setAuth(session.did, { handle: session.fetchHandler.bind(session) }, token.scope);
}

let callbackIntent: string | undefined;
export function takeLoginIntent() {
	const path = callbackIntent;
	callbackIntent = undefined;
	return path;
}

let initialization: Promise<void> | undefined;
export function restoreAuth(): Promise<void> {
	return initialization ??= initialize();
}

async function mayHaveSession() {
	try {
		// Both Next web builds use this SDK database. A browser unable to list it still runs the SDK restore.
		return (await indexedDB.databases()).some(database => database.name === '@atproto-oauth-client');
	} catch { return true; }
}

async function initialize() {
	if (location.pathname.replace(/\/$/, '') === '/oauth/callback') {
		const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
		history.replaceState(history.state, '', location.pathname);
		let tealUpgrade: string | null = null;
		try {
			tealUpgrade = sessionStorage.getItem(tealUpgradeKey);
			sessionStorage.removeItem(tealUpgradeKey);
		} catch {}
		try {
			const { session, state } = await (await oauthClient()).initCallback(params);
			callbackIntent = returnPath(state);
			const approvingTeal = tealUpgrade && state === 'teal:' + tealUpgrade;
			if (approvingTeal && session.did !== tealUpgrade) throw new Error('Teal permission belongs to another account');
			completeQueueLogin(true);
			await activate(session);
			if (approvingTeal) {
				const approved = canScrobble();
				if (approved) setPrefs({ tealScrobbling: true });
				callbackIntent = approved ? '/settings' : '/settings?teal=permission';
			}
		} catch {
			completeQueueLogin(false);
			if (tealUpgrade) {
				try {
					await activate(await (await oauthClient()).restore(tealUpgrade));
					callbackIntent = '/settings?teal=permission';
					return;
				} catch {}
			}
			const reason = params.get('error');
			auth.clearAuth(reason === 'access_denied' ? 'sign-in was cancelled.'
				: reason === 'invalid_scope' ? 'your account host did not accept these permissions.'
				: 'could not finish sign-in. try again.', reason === 'invalid_scope');
		}
		return;
	}
	if (!await mayHaveSession()) { auth.clearAuth(); return; }
	try {
		const restored = await (await oauthClient()).initRestore();
		if (restored) {
			await activate(restored.session);
			return;
		}
	} catch {}
	auth.clearAuth();
}

export async function login(identifier: string, deviceOnly: boolean, intent?: string) {
	await prepareQueueLogin();
	const scope = await auth.scopeFor(identifier, deviceOnly);
	await (await oauthClient()).signInRedirect(identifier, { scope, state: returnPath(intent) });
}

export async function authorizeScrobbling() {
	const { did } = auth.getAuth();
	if (!did) throw new Error('sign in to connect teal.fm');
	if (canScrobble()) {
		setPrefs({ tealScrobbling: true });
		return;
	}
	sessionStorage.setItem(tealUpgradeKey, did);
	try {
		const scope = [...new Set([...grantedScope.split(' ').filter(Boolean), TEAL_SCOPE])].join(' ');
		await (await oauthClient()).signInRedirect(did, { scope, state: 'teal:' + did });
	} catch (error) {
		sessionStorage.removeItem(tealUpgradeKey);
		throw error;
	}
}

export async function logout() {
	const { did } = auth.getAuth();
	grantedScope = '';
	auth.clearAuth();
	if (did) await oauthClient().then(client => client.revoke(did)).catch(() => undefined);
}
