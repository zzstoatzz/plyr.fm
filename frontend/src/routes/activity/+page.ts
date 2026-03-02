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
		const [feedRes, histRes] = await Promise.all([
			fetch(`${API_URL}/activity/`),
			fetch(`${API_URL}/activity/histogram?days=7`)
		]);

		const feed = feedRes.ok
			? await feedRes.json()
			: { events: [], next_cursor: null, has_more: false };

		const histogram = histRes.ok ? (await histRes.json()).buckets : [];

		return { ...feed, histogram };
	} catch (e) {
		console.error('failed to load activity feed:', e);
		return empty;
	}
}
