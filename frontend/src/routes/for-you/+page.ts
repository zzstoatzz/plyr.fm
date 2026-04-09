import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { API_URL } from '$lib/config';
import { auth } from '$lib/auth.svelte';
import type { Track } from '$lib/types';

export interface PageData {
	tracks: Track[];
	next_cursor: string | null;
	has_more: boolean;
	cold_start: boolean;
}

export const ssr = false;
export const prerender = false;

const EMPTY: PageData = {
	tracks: [],
	next_cursor: null,
	has_more: false,
	cold_start: false
};

export async function load(): Promise<PageData> {
	if (!browser) return EMPTY;

	await auth.initialize();
	if (!auth.isAuthenticated) {
		throw redirect(302, '/');
	}

	try {
		const response = await fetch(`${API_URL}/for-you/`, {
			credentials: 'include'
		});
		if (!response.ok) {
			console.error('for-you feed request failed:', response.status);
			return EMPTY;
		}
		return await response.json();
	} catch (e) {
		console.error('failed to load for-you feed:', e);
		return EMPTY;
	}
}
