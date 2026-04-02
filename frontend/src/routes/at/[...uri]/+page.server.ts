import { error, redirect } from '@sveltejs/kit';
import { AtUri } from '@atproto/api';
import { API_URL } from '$lib/config';
import type { PageServerLoad } from './$types';

/**
 * resolve AT-URIs to canonical plyr.fm pages.
 *
 * handles URLs like: https://plyr.fm/at://did:plc:xxx/fm.plyr.track/rkey
 * browsers may normalize the :// so we accept multiple path forms.
 */
export const load: PageServerLoad = async ({ params, fetch }) => {
	// reconstruct AT-URI from the catch-all path segment.
	// browsers may collapse "://" to ":/" or strip it entirely,
	// so we normalize by stripping any leading ":/" or "://" prefix.
	const raw = params.uri;
	const cleaned = raw.replace(/^:\/{1,2}/, '');
	const atUriStr = `at://${cleaned}`;

	let uri: AtUri;
	try {
		uri = new AtUri(atUriStr);
	} catch {
		throw error(400, 'invalid AT-URI');
	}

	// bare authority (at://did:plc:xxx) → profile page
	if (!uri.collection) {
		throw redirect(301, `/u/${uri.hostname}`);
	}

	if (!uri.rkey) {
		throw error(400, 'AT-URI with collection must include rkey');
	}

	// route by collection suffix — handles environment-aware namespaces
	// (fm.plyr.track, fm.plyr.stg.track, fm.plyr.dev.track, etc.)
	if (uri.collection.endsWith('.track')) {
		const response = await fetch(
			`${API_URL}/tracks/by-uri?uri=${encodeURIComponent(uri.toString())}`
		);
		if (!response.ok) {
			throw error(404, 'track not found');
		}
		const track: { id: number } = await response.json();
		throw redirect(301, `/track/${track.id}`);
	}

	if (uri.collection.endsWith('.list')) {
		const response = await fetch(
			`${API_URL}/lists/by-uri?uri=${encodeURIComponent(uri.toString())}`
		);
		if (!response.ok) {
			throw error(404, 'list not found');
		}
		const list: { type: 'album' | 'playlist'; id: string; handle?: string; slug?: string } =
			await response.json();
		if (list.type === 'album' && list.handle && list.slug) {
			throw redirect(301, `/u/${list.handle}/album/${list.slug}`);
		}
		throw redirect(301, `/playlist/${list.id}`);
	}

	throw error(404, `unsupported collection: ${uri.collection}`);
};
