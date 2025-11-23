import { API_URL } from '$lib/config';
import type { Track } from '$lib/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
	try {
		const response = await fetch(`${API_URL}/tracks/${params.id}`);

		if (!response.ok) {
			throw error(404, 'track not found');
		}

		const track: Track = await response.json();

		return {
			track
		};
	} catch (e) {
		console.error('failed to load track:', e);
		throw error(404, 'track not found');
	}
};
