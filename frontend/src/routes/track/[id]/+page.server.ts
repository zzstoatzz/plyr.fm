import { API_URL, IS_ZIG_V1 } from '$lib/config';
import { getZigTrack } from '$lib/api/zig-v1';
import type { Track } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	// SSR runs ANONYMOUSLY — the session cookie is scoped to the API host, not
	// this frontend host, so we can't authenticate here. a public track loads
	// fine (and gets its SEO/og tags); a private track 404s even for its owner.
	// in that case return a null track and let the page refetch client-side with
	// the user's session, which can read an owner's own private track.
	try {
		if (IS_ZIG_V1) {
			return { track: await getZigTrack(API_URL, params.id, fetch) };
		}
		const response = await fetch(`${API_URL}/tracks/${params.id}`);
		if (!response.ok) {
			return { track: null };
		}
		const track: Track = await response.json();
		return { track };
	} catch (e) {
		console.error('failed to load track:', e);
		return { track: null };
	}
};
