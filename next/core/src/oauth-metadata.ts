import { TEAL_SCOPE_PARTS } from './teal-scrobble.ts';
import type { AuthConfig } from './auth-config.ts';

/** every scope part this client registers; a request may ask only for these */
export function registeredScopeParts(config: AuthConfig): string[] {
	// teal's and the moderator grants are only ever added on top of a session
	return [...new Set([...config.SCOPE_PARTS, ...TEAL_SCOPE_PARTS, ...config.MODERATOR_SCOPE_PARTS])];
}

export function oauthMetadata(config: AuthConfig, applicationType: 'web' | 'native') {
	const { SITE_URL, NATIVE_REDIRECT_URI } = config;
	const native = applicationType === 'native';
	const filename = native ? 'oauth-native-client-metadata.json' : 'oauth-client-metadata.json';
	return {
		client_id: `${SITE_URL}/${filename}`,
		client_name: 'plyr.fm (next)',
		client_uri: SITE_URL,
		redirect_uris: [native ? NATIVE_REDIRECT_URI : `${SITE_URL}/oauth/callback`],
		scope: registeredScopeParts(config).join(' '),
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		application_type: applicationType,
		dpop_bound_access_tokens: true
	};
}
