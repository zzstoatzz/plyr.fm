// content moderation state - tracks explicit images
import { browser } from '$app/environment';
import { API_URL } from '$lib/config';

interface ExplicitImages {
	image_ids: Set<string>;
	urls: Set<string>;
}

class ModerationManager {
	private data = $state<ExplicitImages>({ image_ids: new Set(), urls: new Set() });
	private initialized = false;
	loading = $state(false);

	/**
	 * check if an image URL is flagged as explicit.
	 * checks both the full URL and extracts image_id from R2 URLs.
	 */
	isExplicit(url: string | null | undefined): boolean {
		if (!url) return false;

		// check full URL match
		if (this.data.urls.has(url)) return true;

		// extract image_id from R2 URL pattern and check
		// R2 URLs look like: https://cdn.plyr.fm/images/{image_id}.webp
		const match = url.match(/\/images\/([^/.]+)\./);
		if (match && this.data.image_ids.has(match[1])) return true;

		return false;
	}

	async initialize(): Promise<void> {
		if (!browser || this.initialized || this.loading) return;
		this.initialized = true;
		await this.fetch();
	}

	async fetch(): Promise<void> {
		if (!browser) return;

		this.loading = true;
		try {
			const response = await fetch(`${API_URL}/moderation/explicit-images`);
			if (response.ok) {
				const data = await response.json();
				this.data = {
					image_ids: new Set(data.image_ids || []),
					urls: new Set(data.urls || [])
				};
			}
		} catch (error) {
			console.error('failed to fetch explicit images:', error);
		} finally {
			this.loading = false;
		}
	}
}

export const moderation = new ModerationManager();
