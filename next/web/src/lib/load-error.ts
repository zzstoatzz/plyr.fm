import { error } from '@sveltejs/kit';
import { ApiError } from '@plyr/next-core/api';

/**
 * Runs a page's API read and turns a failure into a real SvelteKit error, so the
 * error page gets a 404 for something that isn't there instead of a bare 500.
 * `missing` is what the not-found page says, e.g. "we couldn't find that artist".
 */
export async function loadOrError<T>(read: () => Promise<T>, missing: string): Promise<T> {
	try {
		return await read();
	} catch (cause) {
		if (cause instanceof ApiError && (cause.status === 400 || cause.status === 404)) error(404, missing);
		error(503, cause instanceof ApiError ? cause.message : "plyr.fm couldn't load this. try again in a moment.");
	}
}
