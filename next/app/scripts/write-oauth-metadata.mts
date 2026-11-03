import { writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { NATIVE_REDIRECT_URI, SCOPE_PARTS, SITE_URL } from '../src/auth-config.ts';

for (const applicationType of ['web', 'native'] as const) {
	const native = applicationType === 'native';
	const filename = native ? 'oauth-native-client-metadata.json' : 'oauth-client-metadata.json';
	const metadata = {
		client_id: `${SITE_URL}/${filename}`,
		client_name: 'plyr.fm (next)',
		client_uri: SITE_URL,
		redirect_uris: [native ? NATIVE_REDIRECT_URI : `${SITE_URL}/oauth/callback`],
		scope: SCOPE_PARTS.join(' '),
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		application_type: applicationType,
		dpop_bound_access_tokens: true
	};
	await writeFile(new URL(`../dist/${filename}`, import.meta.url), JSON.stringify(metadata) + '\n');
}
