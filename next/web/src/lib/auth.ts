import { Client } from '@atcute/client';
import type { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser';
import { createAuthState, type Did } from '@plyr/next-core/auth-state';
import { hasTealGrant, hasTealPlayGrant, TEAL_SCOPE_PARTS } from '@plyr/next-core/teal-scrobble';
import { registeredScopeParts } from '@plyr/next-core/oauth-metadata';
import { upgradeScope } from '@plyr/next-core/scope-upgrade';
import { setPrefs } from './prefs.svelte';
import { returnPath } from '@plyr/next-core/return-path';
import { authConfig } from './auth-config';
import { completeQueueLogin, prepareQueueLogin } from './storage/queue-login';
import { forgetShelf, savedShelf } from './listening/saved-shelf';

const { SITE_URL } = authConfig;
const REGISTERED_SCOPE = registeredScopeParts(authConfig);
const tealUpgradeKey = 'plyr-next:teal-upgrade';
let grantedScope = '';
export function canScrobble() { return hasTealGrant(grantedScope); }
export function canLogPlays() { return hasTealPlayGrant(grantedScope); }
export const auth = createAuthState(authConfig, handler => new Client({ handler }));

const addAccountKey = 'plyr-next:add-account';
const grantUpgradeKey = 'plyr-next:grant-upgrade';
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
	const { did, handle, ready } = auth.getAuth();
	// signed out, or switched to another account: the saved shelf must not draw for anyone else
	if (ready && (!did || savedShelf()?.did !== did)) forgetShelf();
	if (!did) return;
	const known = knownAccounts();
	saveKnownAccounts([{ did, handle: handle || known.find(item => item.did === did)?.handle || null }, ...known.filter(item => item.did !== did)]);
});

export type OtherAccount = AccountIdentity & { signedIn: boolean };

/** dids this browser still holds a session for: the SDK's own store, read without refreshing anything */
async function storedSessions(): Promise<Set<string>> {
	try {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('@atproto-oauth-client');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			if (!db.objectStoreNames.contains('session')) return new Set();
			const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
				const request = db.transaction('session').objectStore('session').getAllKeys();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return new Set(keys.filter(key => typeof key === 'string'));
		} finally { db.close(); }
	} catch { return new Set(); }
}

/**
 * The other accounts this tab has used. An account whose session this browser no longer holds
 * stays listed as signed out, so it can be signed back into or removed, never offered as a switch that can't work.
 */
export async function otherAccounts(): Promise<OtherAccount[]> {
	const others = knownAccounts().filter(item => item.did !== auth.getAuth().did);
	if (!others.length) return [];
	const held = await storedSessions();
	return others.map(item => ({ ...item, signedIn: held.has(item.did) }));
}

/** Why a switch didn't happen: the session is gone (sign in again), or the account host couldn't be reached (try again). */
export class SwitchError extends Error {
	constructor(readonly reason: 'signed-out' | 'unreachable', options?: ErrorOptions) {
		super(reason === 'signed-out' ? 'signed out' : 'unreachable', options);
	}
}

let switchingAccount: Promise<void> | undefined;
export function switchAccount(did: Did): Promise<void> {
	if (switchingAccount) return switchingAccount;
	const previous = auth.getAuth().rpc;
	switchingAccount = (async () => {
		const client = await oauthClient().catch(cause => { throw new SwitchError('unreachable', { cause }); });
		let session: OAuthSession;
		try { session = await client.restore(did); }
		catch (cause) {
			console.warn('account switch failed', cause);
			// the SDK drops a session it can't refresh (even over a dropped connection), so ask the store what is left
			const gone = !(await storedSessions()).has(did);
			throw new SwitchError(gone ? 'signed-out' : 'unreachable', { cause });
		}
		await activate(session, () => auth.getAuth().rpc === previous);
	})().finally(() => { switchingAccount = undefined; });
	return switchingAccount;
}

/** Signs back into an account whose session ended. Cancelling at the account host comes back to the current account. */
export function signBackIn(account: AccountIdentity, intent: string) {
	return login(account.handle ?? account.did, false, intent, 'reconnect');
}

/** Takes an account off this tab's list and ends whatever session this browser still holds for it. */
export async function forgetAccount(did: Did) {
	saveKnownAccounts(knownAccounts().filter(item => item.did !== did));
	if (did === auth.getAuth().did) return;
	const current = localStorage.getItem(currentSubKey);
	// the SDK's revoke also forgets which account restores on reload; that is still the current one
	await oauthClient().then(client => client.revoke(did)).catch(() => undefined);
	if (current) localStorage.setItem(currentSubKey, current);
}
const currentSubKey = '@@atproto/oauth-client-browser(sub)';

let client: Promise<BrowserOAuthClient> | undefined;
function oauthClient() {
	if (client) return client;
	const loopback = location.hostname === '127.0.0.1';
	const redirect = `${location.origin}/oauth/callback`;
	const clientId = loopback
		? `http://localhost?redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(REGISTERED_SCOPE.join(' '))}`
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
		let grantUpgrade: { did: string; returnTo: string } | null = null;
		try {
			tealUpgrade = sessionStorage.getItem(tealUpgradeKey);
			previousAccount = sessionStorage.getItem(addAccountKey);
			const upgrade: unknown = JSON.parse(sessionStorage.getItem(grantUpgradeKey) ?? 'null');
			if (upgrade && typeof upgrade === 'object' && 'did' in upgrade && typeof upgrade.did === 'string' && 'returnTo' in upgrade && typeof upgrade.returnTo === 'string') grantUpgrade = { did: upgrade.did, returnTo: upgrade.returnTo };
			sessionStorage.removeItem(tealUpgradeKey);
			sessionStorage.removeItem(addAccountKey);
			sessionStorage.removeItem(grantUpgradeKey);
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
			// a declined upgrade keeps the session it started from
			const restoreDid = tealUpgrade ?? grantUpgrade?.did ?? previousAccount;
			if (restoreDid) {
				try {
					await activate(await (await oauthClient()).restore(restoreDid));
					callbackIntent = tealUpgrade ? '/settings?teal=permission' : grantUpgrade ? returnPath(grantUpgrade.returnTo) ?? '/' : '/settings';
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

export async function login(identifier: string, deviceOnly: boolean, intent?: string, addAccount: boolean | 'reconnect' = false) {
	await prepareQueueLogin();
	const scope = await auth.scopeFor(identifier, deviceOnly);
	const previous = addAccount ? auth.getAuth().did : null;
	if (previous) sessionStorage.setItem(addAccountKey, previous);
	try {
		await (await oauthClient()).signInRedirect(identifier, { scope, state: returnPath(intent), ...(addAccount === true ? { prompt: 'login' as const } : {}) });
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
		const scope = upgradeScope(REGISTERED_SCOPE, grantedScope, TEAL_SCOPE_PARTS, did);
		await (await oauthClient()).signInRedirect(did, { scope, state: 'teal:' + did });
	} catch (error) {
		sessionStorage.removeItem(tealUpgradeKey);
		throw error;
	}
}

/**
 * What to tell someone whose grant upgrade didn't start. null when there is nothing to say:
 * they went to their account host and came back without answering.
 */
export function grantFailure(error: unknown): string | null {
	if (error instanceof Error && error.message === 'User navigated back') return null;
	const code = typeof error === 'object' && error && 'error' in error && typeof error.error === 'string' ? error.error : null;
	if (code === 'invalid_scope') return "your account host didn't accept this permission. try again, or sign out and back in.";
	if (code) return `your account host said no (${code}). try again.`;
	if (error instanceof TypeError) return "couldn't reach your account host. check your connection and try again.";
	return "couldn't start that with your account host. try again.";
}

/** Adds grants to the signed-in session (reporting, the review queue) and comes back to `returnTo`. */
export async function addGrants(parts: readonly string[], returnTo: string) {
	const { did } = auth.getAuth();
	if (!did) throw new Error('sign in first');
	const scope = upgradeScope(REGISTERED_SCOPE, grantedScope, parts, did);
	try { sessionStorage.setItem(grantUpgradeKey, JSON.stringify({ did, returnTo })); } catch {}
	try {
		await (await oauthClient()).signInRedirect(did, { scope, state: returnPath(returnTo) });
	} catch (error) {
		try { sessionStorage.removeItem(grantUpgradeKey); } catch {}
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
