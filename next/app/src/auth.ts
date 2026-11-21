import { ExpoOAuthClient, TokenInvalidError, TokenRefreshError, TokenRevokedError, type OAuthSession } from '@atproto/oauth-client-expo';
import { hasTealGrant, hasTealPlayGrant, TEAL_SCOPE_PARTS } from '@plyr/next-core/teal-scrobble';
import { upgradeScope } from '@plyr/next-core/scope-upgrade';
import { NATIVE_REDIRECT_URI, BASE_SCOPE_PARTS, MODERATOR_SCOPE_PARTS, SCOPE_PARTS, SITE_URL } from './auth-config';
import { registeredScopeParts } from '@plyr/next-core/oauth-metadata';
import { restoreWithin, type RestoreOutcome } from './auth-restore';
import { clearAuth, getAuth, scopeFor, setAuth } from './auth-state';
import { prepareQueueLogin } from './queue-login';
import { readLocal, removeLocal, writeLocal } from './storage';

export { useAuth } from './auth-state';
export const authAvailable = true;
const ACTIVE_KEY = 'plyr-next:active-did';
const RESTORE_DEADLINE_MS = 8000;

// the same list the served native client metadata registers
const REGISTERED_SCOPE = registeredScopeParts({ SCOPE_PARTS, MODERATOR_SCOPE_PARTS });
let grantedScope = '';
let client: ExpoOAuthClient | undefined;
function oauthClient() {
	return client ??= new ExpoOAuthClient({
		handleResolver: 'https://bsky.social',
		clientMetadata: {
			client_id: `${SITE_URL}/oauth-native-client-metadata.json`,
			client_name: 'plyr.fm (next)',
			client_uri: SITE_URL,
			redirect_uris: [NATIVE_REDIRECT_URI],
			scope: REGISTERED_SCOPE.join(' '),
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			application_type: 'native',
			dpop_bound_access_tokens: true
		}
	});
}

function activate(session: OAuthSession, scope: string) {
	grantedScope = scope;
	setAuth(session.did, { handle: session.fetchHandler.bind(session) }, scope);
}

// The library also treats network TypeErrors as fatal; a dropped connection is not a revoked session.
const sessionGone = (reason: unknown) => reason instanceof TokenRefreshError || reason instanceof TokenRevokedError
	|| reason instanceof TokenInvalidError;

let restoring: Promise<void> | undefined;
export function restoreAuth(): Promise<void> {
	return restoring ??= restoreActive().finally(() => { restoring = undefined; });
}

async function restoreActive() {
	const did = readLocal(ACTIVE_KEY);
	if (!did) return clearAuth();
	// Restoring may refresh the token; getTokenInfo then reads the fresh set.
	const attempt = oauthClient().restore(did).then(async (session: OAuthSession): Promise<Restored> => ({ session, scope: (await session.getTokenInfo()).scope }));
	const result = await restoreWithin<Restored>(attempt, RESTORE_DEADLINE_MS, sessionGone);
	if (result.kind !== 'slow') return settleRestore(result);
	clearAuth('your account server is slow to answer. playing signed out until it does.');
	void result.late.then(outcome => {
		// Only apply a late result if nobody signed in or out in the meantime.
		if (readLocal(ACTIVE_KEY) === did && !getAuth().did) settleRestore(outcome);
	});
}

type Restored = { session: OAuthSession; scope: string };
function settleRestore(outcome: RestoreOutcome<Restored>) {
	if (outcome.kind === 'restored') {
		const { session, scope } = outcome.value;
		return activate(session, scope);
	}
	if (outcome.kind === 'expired') {
		removeLocal(ACTIVE_KEY);
		return clearAuth('your session expired. sign in again.');
	}
	// Keep the account on this device; the next launch tries again.
	clearAuth("couldn't reach your account server. playing signed out.");
}

export function takeLoginIntent(): undefined { return undefined; }

export async function login(identifier: string, deviceOnly = false, intent?: string) {
	const handle = identifier.trim().replace(/^@/, '');
	await prepareQueueLogin();
	const session = await oauthClient().signIn(handle, {
		scope: await scopeFor(handle, deviceOnly),
		redirect_uri: NATIVE_REDIRECT_URI
	});
	activate(session, (await session.getTokenInfo()).scope);
	writeLocal(ACTIVE_KEY, session.did);
}

export async function createAccount(provider: string, _intent?: string) {
	await prepareQueueLogin();
	const session = await oauthClient().signIn(provider, {
		scope: BASE_SCOPE_PARTS.join(' '), prompt: 'create', redirect_uri: NATIVE_REDIRECT_URI
	});
	activate(session, (await session.getTokenInfo()).scope);
	writeLocal(ACTIVE_KEY, session.did);
}

export function canScrobble() {
	return !!getAuth().did && hasTealGrant(grantedScope);
}

export function canLogPlays() {
	return !!getAuth().did && hasTealPlayGrant(grantedScope);
}

export async function authorizeScrobbling() {
	const { did, agent } = getAuth();
	if (!did) throw new Error('sign in to connect teal.fm');
	if (canScrobble()) return;
	const scope = upgradeScope(REGISTERED_SCOPE, grantedScope, TEAL_SCOPE_PARTS, did);
	await prepareQueueLogin();
	if (getAuth().agent !== agent) throw new Error('account changed');
	const session = await oauthClient().signIn(did, { scope, redirect_uri: NATIVE_REDIRECT_URI });
	const token = await session.getTokenInfo();
	if (session.did !== did || getAuth().agent !== agent) throw new Error('account changed');
	activate(session, token.scope);
	if (!hasTealGrant(token.scope)) throw new Error('teal.fm permission was not granted');
}

export async function logout() {
	const { did } = getAuth();
	clearAuth();
	removeLocal(ACTIVE_KEY);
	if (did) await oauthClient().revoke(did);
}
