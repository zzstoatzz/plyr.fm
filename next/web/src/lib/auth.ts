import { Client } from '@atcute/client';
import type { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser';
import { createAuthState, type Did } from '@plyr/next-core/auth-state';
import { hasTealGrant, hasTealPlayGrant, TEAL_SCOPE_PARTS } from '@plyr/next-core/teal-scrobble';
import { setPrefs } from './prefs.svelte';
import { returnPath } from '@plyr/next-core/return-path';
import { authConfig } from './auth-config';
import { completeQueueLogin, prepareQueueLogin } from './storage/queue-login';

const { SITE_URL, SCOPE_PARTS } = authConfig;
const tealUpgradeKey = 'plyr-next:teal-upgrade';
let grantedScope = '';
export function canScrobble() { return hasTealGrant(grantedScope); }
export function canLogPlays() { return hasTealPlayGrant(grantedScope); }
export const auth = createAuthState(authConfig, handler => new Client({ handler }));

const addAccountKey = 'plyr-next:add-account';
const accountDirectoryKey = 'plyr-next:recent-accounts';
type AccountIdentity = { did: Did; handle: string | null };

function knownAccounts(): AccountIdentity[] {
	try {
		const accounts: unknown = JSON.parse(sessionStorage.getItem(accountDirectoryKey) ?? '[]');
		if (Array.isArray(accounts)) return accounts.filter(item => typeof item?.did === 'string'
			&& /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(item.did) && (typeof item.handle === 'string' || item.handle === null));
	} catch {}
	return [];
}

function saveKnownAccounts(accounts: AccountIdentity[]) {
	try { sessionStorage.setItem(accountDirectoryKey, JSON.stringify(accounts.slice(0, 8))); } catch {}
}

auth.subscribe(() => {
	const { did, handle } = auth.getAuth();
	if (!did) return;
	const known = knownAccounts();
	saveKnownAccounts([{ did, handle: handle || known.find(item => item.did === did)?.handle || null }, ...known.filter(item => item.did !== did)]);
});

export function otherAccounts() { return knownAccounts().filter(item => item.did !== auth.getAuth().did); }

let switchingAccount: Promise<void> | undefined;
export function switchAccount(did: Did): Promise<void> {
	if (switchingAccount) return switchingAccount;
	const previous = auth.getAuth().rpc;
	switchingAccount = oauthClient()
		.then(client => client.restore(did))
		.then(session => activate(session, () => auth.getAuth().rpc === previous))
		.finally(() => { switchingAccount = undefined; });
	return switchingAccount;
}

let client: Promise<BrowserOAuthClient> | undefined;
function oauthClient() {
	if (client) return client;
	const loopback = location.hostname === '127.0.0.1';
	const redirect = `${location.origin}/oauth/callback`;
	const clientId = loopback
		? `http://localhost?redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent([...SCOPE_PARTS, ...TEAL_SCOPE_PARTS].join(' '))}`
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

async function activate(session: OAuthSession, current = () => true) {
	const token = await session.getTokenInfo();
	if (!current()) return;
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
		let previousAccount: string | null = null;
		try {
			tealUpgrade = sessionStorage.getItem(tealUpgradeKey);
			previousAccount = sessionStorage.getItem(addAccountKey);
			sessionStorage.removeItem(tealUpgradeKey);
			sessionStorage.removeItem(addAccountKey);
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
			const restoreDid = tealUpgrade ?? previousAccount;
			if (restoreDid) {
				try {
					await activate(await (await oauthClient()).restore(restoreDid));
					callbackIntent = tealUpgrade ? '/settings?teal=permission' : '/settings';
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

export async function login(identifier: string, deviceOnly: boolean, intent?: string, addAccount = false) {
	await prepareQueueLogin();
	const scope = await auth.scopeFor(identifier, deviceOnly);
	const previous = addAccount ? auth.getAuth().did : null;
	if (previous) sessionStorage.setItem(addAccountKey, previous);
	try {
		await (await oauthClient()).signInRedirect(identifier, { scope, state: returnPath(intent), ...(addAccount ? { prompt: 'login' as const } : {}) });
	} catch (error) {
		if (previous) sessionStorage.removeItem(addAccountKey);
		throw error;
	}
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
		const scope = [...new Set([...grantedScope.split(' ').filter(Boolean), ...TEAL_SCOPE_PARTS])].join(' ');
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
	if (did) saveKnownAccounts(knownAccounts().filter(item => item.did !== did));
	await switchingAccount?.catch(() => undefined);
	if (did) await oauthClient().then(client => client.revoke(did)).catch(() => undefined);
}
