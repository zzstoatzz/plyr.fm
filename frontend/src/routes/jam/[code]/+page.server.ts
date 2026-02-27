import { API_URL } from '$lib/config';
import type { PageServerLoad } from './$types';

interface JamPreview {
	code: string;
	name: string | null;
	is_active: boolean;
	host_handle: string;
	host_display_name: string;
	host_avatar_url: string | null;
	participant_count: number;
}

export const load: PageServerLoad = async ({ params, fetch }) => {
	let preview: JamPreview | null = null;
	try {
		const response = await fetch(`${API_URL}/jams/${params.code}/preview`);
		if (response.ok) {
			preview = await response.json();
		}
	} catch {
		// best-effort — preview is optional
	}

	return {
		code: params.code,
		preview
	};
};
