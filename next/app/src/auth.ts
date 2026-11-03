import { ExpoOAuthClient, type OAuthSession } from '@atproto/oauth-client-expo';
import { NATIVE_REDIRECT_URI, BASE_SCOPE_PARTS, SCOPE_PARTS, SITE_URL } from './auth-config';
import { clearAuth, getAuth, scopeFor, setAuth } from './auth-state';
import { readLocal, removeLocal, writeLocal } from './storage';

export { useAuth } from './auth-state';
export const authAvailable = true;
const ACTIVE_KEY = 'plyr-next:active-did';

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

export async function restoreAuth() {
	const did = readLocal(ACTIVE_KEY);
	if (did) {
		try {
			await activate(await oauthClient().restore(did));
			return;
		} catch {
			/* A revoked or inaccessible session should leave a usable signed-out app. */
		}
	}
	clearAuth();
}

export function takeLoginIntent(): undefined { return undefined; }

export async function login(identifier: string, deviceOnly = false, intent?: string) {
	const handle = identifier.trim().replace(/^@/, '');
	const session = await oauthClient().signIn(handle, {
		scope: await scopeFor(handle, deviceOnly, intent?.startsWith('/jam/')),
		redirect_uri: NATIVE_REDIRECT_URI
	});
	await activate(session);
	writeLocal(ACTIVE_KEY, session.did);
}

export async function createAccount(provider: string, _intent?: string) {
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
