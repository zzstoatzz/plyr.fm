import { API_URL } from '$lib/config';
import type { LayoutServerLoad } from './$types';

export interface SensitiveImages {
	image_ids: string[];
	urls: string[];
}

export const load: LayoutServerLoad = async ({ fetch }) => {
	let sensitiveImages: SensitiveImages = { image_ids: [], urls: [] };

	try {
		const response = await fetch(`${API_URL}/moderation/sensitive-images`);
		if (response.ok) {
			sensitiveImages = await response.json();
		}
	} catch (e) {
		console.error('failed to fetch sensitive images:', e);
	}

	return {
		sensitiveImages
	};
};
