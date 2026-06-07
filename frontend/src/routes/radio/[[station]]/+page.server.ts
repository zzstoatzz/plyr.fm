import { API_URL } from '$lib/config';
import type { PageServerLoad } from './$types';

interface Station {
	slug: string;
	name: string;
	description: string;
}

/**
 * Resolve the station named in the path (if any) so the page can render a
 * per-station link preview server-side, where scrapers can see it. A bare
 * `/radio` (or an unknown slug) returns `null` → generic radio preview.
 */
export const load: PageServerLoad = async ({ params, fetch }) => {
	const slug = params.station;
	if (!slug) return { station: null };
	try {
		const response = await fetch(`${API_URL}/radio/stations`);
		if (!response.ok) return { station: null };
		const data: { stations: Station[] } = await response.json();
		return { station: data.stations.find((s) => s.slug === slug) ?? null };
	} catch {
		return { station: null };
	}
};
