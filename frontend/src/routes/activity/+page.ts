import { browser } from '$app/environment';
import { API_URL } from '$lib/config';
import type { ActivityEvent, ActivityHistogramBucket } from '$lib/types';

export interface PageData {
	events: ActivityEvent[];
	next_cursor: string | null;
	has_more: boolean;
	histogram: ActivityHistogramBucket[];
}

export const ssr = false;

export async function load(): Promise<PageData> {
	if (!browser) {
		return { events: [], next_cursor: null, has_more: false, histogram: [] };
	}

	const empty: PageData = { events: [], next_cursor: null, has_more: false, histogram: [] };

	try {
		const [feedResult, histResult] = await Promise.allSettled([
			fetch(`${API_URL}/activity/`),
			fetch(`${API_URL}/activity/histogram?days=7`)
		]);

		let feed = { events: [] as ActivityEvent[], next_cursor: null as string | null, has_more: false };
		if (feedResult.status === 'fulfilled' && feedResult.value.ok) {
			feed = await feedResult.value.json();
		}

		let histogram: ActivityHistogramBucket[] = [];
		if (histResult.status === 'fulfilled' && histResult.value.ok) {
			histogram = (await histResult.value.json()).buckets;
		}

		return { ...feed, histogram };
	} catch (e) {
		console.error('failed to load activity feed:', e);
		return empty;
	}
}
