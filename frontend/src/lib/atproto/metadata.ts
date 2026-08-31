/**
 * the browser OAuth client's identity, built in exactly one place.
 *
 * the authserver fetches `client_id` (a URL) and compares the hosted document
 * to what the running client presents — the two must never drift, so both the
 * served route (`routes/oauth-client-metadata.json/+server.ts`) and the
 * in-browser client (`./client.ts`) call this builder. grants on users' PDSes
 * are keyed to `client_id`, so the URL is permanent per environment.
 */

import type { OAuthClientMetadataInput } from '@atproto/oauth-client-browser';

/** the scopes each migrated write type needs; grows per phase of the plan. */
export function clientWriteScope(namespace: string): string {
	return `atproto repo:${namespace}.like?action=create&action=delete`;
}

export function callbackPath(): string {
	return '/atproto/callback';
}

export function buildClientMetadata(origin: string, namespace: string): OAuthClientMetadataInput {
	const redirectUri = `${origin}${callbackPath()}`;
	const scope = clientWriteScope(namespace);
	const local = origin.startsWith('http://127.0.0.1') || origin.startsWith('http://localhost');
	const clientId = local
		? `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`
		: `${origin}/oauth-client-metadata.json`;
	return {
		client_id: clientId,
		client_name: local ? 'plyr.fm (dev)' : 'plyr.fm',
		client_uri: origin,
		redirect_uris: [redirectUri],
		scope,
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		application_type: 'web',
		dpop_bound_access_tokens: true
	};
}
