import { API_URL } from '$lib/config';
import type { ActivityEvent, ActivityHistogramBucket } from '$lib/types';

class ActivityFeedState {
	active = $state(false);
	events = $state<ActivityEvent[]>([]);
	cursor = $state<string | null>(null);
	hasMore = $state(false);
	loading = $state(false);
	histogram = $state<ActivityHistogramBucket[]>([]);

	toggle() {
		this.active = !this.active;
		if (this.active) {
			this.fetch();
		} else {
			this.clear();
		}
	}

	async fetch() {
		this.loading = true;
		try {
			const [feedRes, histRes] = await Promise.allSettled([
				fetch(`${API_URL}/activity/`),
				fetch(`${API_URL}/activity/histogram?days=7`)
			]);
			if (feedRes.status === 'fulfilled' && feedRes.value.ok) {
				const data = await feedRes.value.json();
				this.events = data.events;
				this.cursor = data.next_cursor;
				this.hasMore = data.has_more;
			}
			if (histRes.status === 'fulfilled' && histRes.value.ok) {
				this.histogram = (await histRes.value.json()).buckets;
			}
		} catch (e) {
			console.error('failed to load activity:', e);
		} finally {
			this.loading = false;
		}
	}

	async loadMore() {
		if (!this.hasMore || !this.cursor || this.loading) return;
		this.loading = true;
		try {
			const res = await fetch(
				`${API_URL}/activity/?cursor=${encodeURIComponent(this.cursor)}`
			);
			if (res.ok) {
				const data = await res.json();
				this.events = [...this.events, ...data.events];
				this.cursor = data.next_cursor;
				this.hasMore = data.has_more;
			}
		} catch (e) {
			console.error('failed to load more activity:', e);
		} finally {
			this.loading = false;
		}
	}

	clear() {
		this.events = [];
		this.cursor = null;
		this.hasMore = false;
		this.histogram = [];
	}
}

export const activityFeed = new ActivityFeedState();

export function timeAgo(iso: string): string {
	const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo`;
	return `${Math.floor(days / 365)}y`;
}
