import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// redirect old /liked/[handle] URLs to new /u/[handle]/liked
export const load: PageLoad = async ({ params }) => {
	throw redirect(301, `/u/${params.handle}/liked`);
};
