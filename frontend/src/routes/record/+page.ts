import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/auth.svelte';

export const ssr = false;
export const prerender = false;

export async function load(): Promise<Record<string, never>> {
	if (!browser) return {};

	await auth.initialize();
	if (!auth.isAuthenticated) {
		throw redirect(302, '/');
	}

	// artist-profile enforcement happens server-side on POST /tracks/
	return {};
}
