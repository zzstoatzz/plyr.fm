import { error, redirect } from '@sveltejs/kit';
import { ApiError, type Track } from '@plyr/next-core/api';
import { ownerTrackKey } from '@plyr/next-core/track-access';
import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url }) => {
	const ownerKey = ownerTrackKey(params.id);
	if (ownerKey) return { track: null, ownerKey };
	let track: Track;
	try {
		track = await api.track(params.id);
	} catch (cause) {
		if (cause instanceof ApiError && [400, 404].includes(cause.status)) error(404, 'track not found');
		error(503, 'could not load this track');
	}
	const legacyId = track.legacy_id;
	if (legacyId && params.id !== String(legacyId)) redirect(308, `/track/${legacyId}` + url.search);
	return { track, ownerKey: null };
};
