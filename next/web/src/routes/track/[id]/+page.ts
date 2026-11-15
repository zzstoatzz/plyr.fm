import { error } from '@sveltejs/kit';
import { ApiError } from '@plyr/next-core/api';
import { api } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	try {
		return { track: await api.track(params.id) };
	} catch (cause) {
		if (cause instanceof ApiError && cause.status === 404) error(404, 'track not found');
		error(503, 'could not load this track');
	}
};
