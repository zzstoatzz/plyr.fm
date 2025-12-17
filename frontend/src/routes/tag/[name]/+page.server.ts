import { API_URL } from '$lib/config';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

interface TagDetail {
	name: string;
	track_count: number;
	created_by_handle: string | null;
}

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const response = await fetch(`${API_URL}/tracks/tags/${encodeURIComponent(params.name)}`);

		if (!response.ok) {
			if (response.status === 404) {
				return {
					tag: null,
					trackCount: 0,
					error: `tag "${params.name}" not found`
				};
			}
			throw error(500, 'failed to load tag');
		}

		const data = await response.json();
		const tag = data.tag as TagDetail;

		return {
			tag,
			trackCount: tag.track_count,
			error: null
		};
	} catch (e) {
		console.error('failed to load tag:', e);
		return {
			tag: null,
			trackCount: 0,
			error: 'failed to load tag'
		};
	}
};
