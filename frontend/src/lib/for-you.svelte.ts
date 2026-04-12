import { API_URL } from './config';
import type { Track } from './types';

interface ForYouApiResponse {
	tracks: Track[];
	next_cursor: string | null;
	has_more: boolean;
	cold_start: boolean;
}

class ForYouCache {
	tracks = $state<Track[]>([]);
	loading = $state(false);
	loadingMore = $state(false);
	nextCursor = $state<string | null>(null);
	hasMore = $state(false);
	coldStart = $state(false);
	activeTags = $state<string[]>([]);

	private buildUrl(): URL {
		const url = new URL(`${API_URL}/for-you/`);
		for (const tag of this.activeTags) {
			url.searchParams.append('tags', tag);
		}
		return url;
	}

	async fetch(force = false): Promise<void> {
		if (!force && this.loading) return;

		this.loading = true;
		try {
			const response = await fetch(this.buildUrl().toString(), {
				credentials: 'include'
			});
			if (!response.ok) {
				this.tracks = [];
				this.hasMore = false;
				return;
			}
			const data: ForYouApiResponse = await response.json();
			this.tracks = data.tracks;
			this.nextCursor = data.next_cursor;
			this.hasMore = data.has_more;
			this.coldStart = data.cold_start;
		} catch (e) {
			console.error('failed to fetch for-you feed:', e);
			this.tracks = [];
			this.hasMore = false;
		} finally {
			this.loading = false;
		}
	}

	async fetchMore(): Promise<void> {
		if (this.loadingMore || this.loading || !this.hasMore || !this.nextCursor) return;

		this.loadingMore = true;
		try {
			const url = this.buildUrl();
			url.searchParams.set('cursor', this.nextCursor);

			const response = await fetch(url.toString(), {
				credentials: 'include'
			});
			if (!response.ok) return;
			const data: ForYouApiResponse = await response.json();

			this.tracks = [...this.tracks, ...data.tracks];
			this.nextCursor = data.next_cursor;
			this.hasMore = data.has_more;
		} catch (e) {
			console.error('failed to fetch more for-you tracks:', e);
		} finally {
			this.loadingMore = false;
		}
	}

	invalidate(): void {
		this.tracks = [];
		this.nextCursor = null;
		this.hasMore = false;
		this.coldStart = false;
	}

	setTags(tags: string[]): void {
		this.activeTags = tags;
		this.nextCursor = null;
		this.hasMore = false;
		this.fetch(true);
	}
}

export const forYouCache = new ForYouCache();
