import { error, redirect } from '@sveltejs/kit';
import { ApiError, type Track } from '@plyr/next-core/api';
import { ownerTrackAddress } from '@plyr/next-core/track-access';
import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url }) => {
	const address = ownerTrackAddress(params.id);
	if (address) return { track: null, address };
	let track: Track;
	try {
		track = await api.track(params.id);
	} catch (cause) {
		if (cause instanceof ApiError && [400, 404].includes(cause.status)) error(404, 'track not found');
		error(503, 'could not load this track');
	}
	const legacyId = track.legacy_id;
	if (legacyId && params.id !== String(legacyId)) redirect(308, `/track/${legacyId}` + url.search);
	return { track, address: null };
};
