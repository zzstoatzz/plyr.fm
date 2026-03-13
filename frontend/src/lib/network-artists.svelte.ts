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
	private lastAttempt = 0;
	private lastSuccess = 0;
	private readonly CACHE_DURATION = 300_000; // 5 minutes
	private readonly RETRY_COOLDOWN = 30_000; // 30 seconds after failure

	get hasArtists(): boolean {
		return this.artists.length > 0;
	}

	async fetch(force = false): Promise<void> {
		if (!browser) return;

		const now = Date.now();
		const isCacheValid =
			this.artists.length > 0 && now - this.lastSuccess < this.CACHE_DURATION;

		if (!force && isCacheValid) return;
		if (this.loading) return;
		// back off after failures to prevent retry storms
		if (!force && now - this.lastAttempt < this.RETRY_COOLDOWN) return;

		this.loading = true;
		this.lastAttempt = now;
		try {
			const response = await fetch(`${API_URL}/discover/network`, {
				credentials: 'include'
			});
			if (response.ok) {
				this.artists = await response.json();
				this.lastSuccess = now;
			}
		} catch (e) {
			console.error('failed to load network artists:', e);
		} finally {
			this.loading = false;
		}
	}
}

export const networkArtistsCache = new NetworkArtistsCache();
