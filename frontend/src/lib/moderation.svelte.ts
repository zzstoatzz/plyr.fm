// content moderation state - tracks sensitive images
import { browser } from '$app/environment';
import { API_URL } from '$lib/config';

interface SensitiveImages {
	image_ids: Set<string>;
	urls: Set<string>;
}

class ModerationManager {
	private data = $state<SensitiveImages>({ image_ids: new Set(), urls: new Set() });
	private initialized = false;
	loading = $state(false);

	/**
	 * check if an image URL is flagged as sensitive.
	 * checks both the full URL and extracts image_id from R2 URLs.
	 */
	isSensitive(url: string | null | undefined): boolean {
		if (!url) return false;

		// check full URL match
		if (this.data.urls.has(url)) return true;

		// extract image_id from R2 URL patterns:
		// - https://pub-*.r2.dev/{image_id}.{ext}
		// - https://cdn.plyr.fm/images/{image_id}.{ext}
		const r2Match = url.match(/r2\.dev\/([^/.]+)\./);
		if (r2Match && this.data.image_ids.has(r2Match[1])) return true;

		const cdnMatch = url.match(/\/images\/([^/.]+)\./);
		if (cdnMatch && this.data.image_ids.has(cdnMatch[1])) return true;

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
			const response = await fetch(`${API_URL}/moderation/sensitive-images`);
			if (response.ok) {
				const data = await response.json();
				this.data = {
					image_ids: new Set(data.image_ids || []),
					urls: new Set(data.urls || [])
				};
			}
		} catch (error) {
			console.error('failed to fetch sensitive images:', error);
		} finally {
			this.loading = false;
		}
	}
}

export const moderation = new ModerationManager();
