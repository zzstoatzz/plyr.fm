/**
 * the browser's own atproto OAuth session — the client-writes substrate.
 *
 * this session is what lets the browser author records in the user's repo
 * (`createRecord`/`uploadBlob` via an `Agent`) instead of asking the backend
 * to. it exists alongside the cookie session: the cookie identifies the user
 * to plyr's API; this identifies them to their own PDS. a user without one
 * (older sign-in, cleared storage, new device) falls back to the server
 * endpoints — callers must treat `agentFor` returning null as that fallback.
 *
 * everything here is loaded lazily so the OAuth library stays out of the main
 * bundle for signed-out visitors.
 */

import { browser } from '$app/environment';
import { getServerConfig } from '$lib/config';
import { buildClientMetadata } from './metadata';
import type { Agent } from '@atproto/api';
import type { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser';

let clientPromise: Promise<BrowserOAuthClient> | null = null;

async function getClient(): Promise<BrowserOAuthClient> {
	if (!browser) throw new Error('atproto client is browser-only');
	clientPromise ??= (async () => {
		const [{ BrowserOAuthClient }, { app_namespace }] = await Promise.all([
			import('@atproto/oauth-client-browser'),
			getServerConfig()
		]);
		return new BrowserOAuthClient({
			clientMetadata: buildClientMetadata(location.origin, app_namespace),
			handleResolver: 'https://slingshot.microcosm.blue'
		});
	})();
	return clientPromise;
}

async function toAgent(session: OAuthSession): Promise<Agent> {
	const { Agent } = await import('@atproto/api');
	return new Agent(session);
}

/**
 * finish an in-flight authorization if the current URL is the callback.
 * returns the page to send the user back to, or null when there was nothing
 * to complete. only the callback page calls this.
 */
export async function completeCallback(): Promise<string | null> {
	const client = await getClient();
	const result = await client.init();
	if (!result || result.state == null) return null;
	return result.state.startsWith('/') ? result.state : '/';
}

/** the signed-in user's PDS agent, or null when this browser holds no session. */
export async function agentFor(did: string): Promise<Agent | null> {
	try {
		const client = await getClient();
		const session = await client.restore(did);
		return await toAgent(session);
	} catch {
		return null;
	}
}

/**
 * make sure this browser can write to `did`'s repo; when it can't, redirect
 * through the authserver (a silent round-trip once consent exists). resolves
 * `false` only when no redirect was needed and no session could be restored.
 */
export async function ensureSession(
	handle: string,
	did: string,
	returnTo: string
): Promise<boolean> {
	if (await agentFor(did)) return true;
	const client = await getClient();
	try {
		await client.signIn(handle, { state: returnTo });
	} catch (e) {
		console.error('atproto sign-in could not start:', e);
		return false;
	}
	// signIn navigates away; this only runs if it somehow returned
	return false;
}
