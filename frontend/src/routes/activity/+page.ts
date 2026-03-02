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
	if (!browser) {
		return { events: [], next_cursor: null, has_more: false };
	}

	try {
		const response = await fetch(`${API_URL}/activity/`);
		if (!response.ok) {
			console.error('failed to load activity feed:', response.status);
			return { events: [], next_cursor: null, has_more: false };
		}
		return await response.json();
	} catch (e) {
		console.error('failed to load activity feed:', e);
		return { events: [], next_cursor: null, has_more: false };
	}
}
