// network artists cache - prevents refetching on navigation
import { browser } from '$app/environment';
import { API_URL } from '$lib/config';

export interface NetworkArtist {
	did: string;
	handle: string;
	display_name: string;
	avatar_url: string | null;
	track_count: number;
}

class NetworkArtistsCache {
	artists = $state<NetworkArtist[]>([]);
	loading = $state(false);
	private lastFetch = 0;
	private readonly CACHE_DURATION = 300_000; // 5 minutes

	get hasArtists(): boolean {
		return this.artists.length > 0;
	}

	async fetch(force = false): Promise<void> {
		if (!browser) return;

		const now = Date.now();
		const isCacheValid =
			this.artists.length > 0 && now - this.lastFetch < this.CACHE_DURATION;

		if (!force && isCacheValid) return;
		if (this.loading) return;

		this.loading = true;
		try {
			const response = await fetch(`${API_URL}/discover/network`, {
				credentials: 'include'
			});
			if (response.ok) {
				this.artists = await response.json();
				this.lastFetch = now;
			}
		} catch (e) {
			console.error('failed to load network artists:', e);
		} finally {
			this.loading = false;
		}
	}
}

export const networkArtistsCache = new NetworkArtistsCache();
