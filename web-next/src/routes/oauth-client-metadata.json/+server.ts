// generated at build so the client_id always matches the deployed origin.
import { json } from '@sveltejs/kit';
import { SCOPE_PARTS, SITE_URL } from '$lib/config';

export const prerender = true;

export function GET() {
	return json({
		client_id: `${SITE_URL}/oauth-client-metadata.json`,
		client_name: 'plyr.fm (next)',
		client_uri: SITE_URL,
		redirect_uris: [`${SITE_URL}/oauth/callback`],
		scope: SCOPE_PARTS.join(' '),
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		application_type: 'web',
		dpop_bound_access_tokens: true
	});
}
