import { ExpoOAuthClient, TokenInvalidError, TokenRefreshError, TokenRevokedError, type OAuthSession } from '@atproto/oauth-client-expo';
import { NATIVE_REDIRECT_URI, BASE_SCOPE_PARTS, SCOPE_PARTS, SITE_URL } from './auth-config';
import { restoreWithin, type RestoreOutcome } from './auth-restore';
import { clearAuth, getAuth, scopeFor, setAuth } from './auth-state';
import { prepareQueueLogin } from './queue-login';
import { readLocal, removeLocal, writeLocal } from './storage';

export { useAuth } from './auth-state';
export const authAvailable = true;
const ACTIVE_KEY = 'plyr-next:active-did';
const RESTORE_DEADLINE_MS = 8000;

let client: ExpoOAuthClient | undefined;
function oauthClient() {
	return client ??= new ExpoOAuthClient({
		handleResolver: 'https://bsky.social',
		clientMetadata: {
			client_id: `${SITE_URL}/oauth-native-client-metadata.json`,
			client_name: 'plyr.fm (next)',
			client_uri: SITE_URL,
			redirect_uris: [NATIVE_REDIRECT_URI],
			scope: SCOPE_PARTS.join(' '),
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			application_type: 'native',
			dpop_bound_access_tokens: true
		}
	});
}

async function activate(session: OAuthSession) {
	const token = await session.getTokenInfo();
	setAuth(session.did, { handle: session.fetchHandler.bind(session) }, token.scope);
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
		return setAuth(session.did, { handle: session.fetchHandler.bind(session) }, scope);
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
	await activate(session);
	writeLocal(ACTIVE_KEY, session.did);
}

export async function createAccount(provider: string, _intent?: string) {
	await prepareQueueLogin();
	const session = await oauthClient().signIn(provider, {
		scope: BASE_SCOPE_PARTS.join(' '), prompt: 'create', redirect_uri: NATIVE_REDIRECT_URI
	});
	await activate(session);
	writeLocal(ACTIVE_KEY, session.did);
}

export async function logout() {
	const { did } = getAuth();
	clearAuth();
	removeLocal(ACTIVE_KEY);
	if (did) await oauthClient().revoke(did);
}
