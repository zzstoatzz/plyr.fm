import { json } from '@sveltejs/kit';
import { getServerConfig } from '$lib/config';
import { buildClientMetadata } from '$lib/atproto/metadata';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const { app_namespace } = await getServerConfig();
	return json(buildClientMetadata(url.origin, app_namespace), {
		headers: { 'cache-control': 'public, max-age=300' }
	});
};
