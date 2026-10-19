// platform stats cache - prevents refetching on navigation
import { browser } from '$app/environment';
import { API_URL } from '$lib/config';

export interface PlatformStats {
	total_plays: number;
	total_tracks: number;
	total_artists: number;
	total_duration_seconds: number;
}

export function formatDuration(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const weeks = Math.floor(hours / 168);
	const days = Math.floor((hours % 168) / 24);

	if (hours >= 24) {
		return [
			weeks > 0 ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'}` : '',
			days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : '',
			hours % 24 > 0 ? `${hours % 24} h` : ''
		]
			.filter(Boolean)
			.join(' ');
	}

	if (hours === 0) {
		return `${minutes}m`;
	}
	if (minutes === 0) {
		return `${hours}h`;
	}
	return `${hours}h ${minutes}m`;
}

class StatsCache {
	data = $state<PlatformStats | null>(null);
	loading = $state(false);
	private lastFetch = 0;
	private readonly CACHE_DURATION = 60_000; // 1 minute

	get stats(): PlatformStats | null {
		return this.data;
	}

	async fetch(force = false): Promise<void> {
		if (!browser) return;

		const now = Date.now();
		const isCacheValid = this.data && now - this.lastFetch < this.CACHE_DURATION;

		if (!force && isCacheValid) return;
		if (this.loading) return;

		this.loading = true;
		try {
			const response = await fetch(`${API_URL}/stats`);
			if (response.ok) {
				this.data = await response.json();
				this.lastFetch = now;
			}
		} catch (e) {
			console.error('failed to load platform stats:', e);
		} finally {
			this.loading = false;
		}
	}
}

export const statsCache = new StatsCache();
