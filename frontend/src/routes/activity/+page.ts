import { browser } from '$app/environment';
import { API_URL } from '$lib/config';
import type { ActivityEvent } from '$lib/types';

export interface PageData {
	events: ActivityEvent[];
	next_cursor: string | null;
	has_more: boolean;
}

export const ssr = false;

export async function load(): Promise<PageData> {
	const empty: PageData = { events: [], next_cursor: null, has_more: false };
	if (!browser) return empty;
	try {
		const result = await fetch(`${API_URL}/activity/`);
		return result.ok ? await result.json() : empty;
	} catch (e) {
		console.error('failed to load activity feed:', e);
		return empty;
	}
}
