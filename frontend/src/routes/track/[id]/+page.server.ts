import { API_URL } from '$lib/config';
import type { Track } from '$lib/types';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch, cookies }) => {
	try {
		// fetch track data server-side for SEO/link previews
		// include session cookie if present to get liked state
		const sessionId = cookies.get('session_id');
		const headers: Record<string, string> = {};
		if (sessionId) {
			headers['Authorization'] = `Bearer ${sessionId}`;
		}

		const response = await fetch(`${API_URL}/tracks/${params.id}`, { headers });

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
