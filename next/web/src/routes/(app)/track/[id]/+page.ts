import { redirect } from '@sveltejs/kit';
import { canonicalId } from '@plyr/next-core/api';
import { ownerTrackAddress } from '@plyr/next-core/track-access';
import { api } from '$lib/api';
import { loadOrError } from '$lib/load-error';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url }) => {
	if (canonicalId(params.id) !== params.id) redirect(308, `/track/${canonicalId(params.id)}` + url.search);
	const address = ownerTrackAddress(params.id);
	if (address) return { track: null, address };
	const track = await loadOrError(() => api.track(params.id), "we couldn't find that track");
	const legacyId = track.legacy_id;
	if (legacyId && params.id !== String(legacyId)) redirect(308, `/track/${legacyId}` + url.search);
	return { track, address: null };
};
