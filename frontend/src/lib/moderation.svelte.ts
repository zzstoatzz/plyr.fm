// content moderation state - tracks sensitive images
import { browser } from '$app/environment';
import { API_URL } from '$lib/config';

interface SensitiveImages {
	image_ids: Set<string>;
	urls: Set<string>;
}

// raw data format from API (arrays, not Sets) - used for SSR
export interface SensitiveImagesData {
	image_ids: string[];
	urls: string[];
}

/**
 * check if an image URL matches sensitive image data.
 * works with both Set-based (client) and array-based (SSR) data.
 */
export function checkImageSensitive(
	url: string | null | undefined,
	data: { image_ids: Set<string> | string[]; urls: Set<string> | string[] }
): boolean {
	if (!url) return false;

	// check full URL match
	const urlsHas = Array.isArray(data.urls)
		? data.urls.includes(url)
		: data.urls.has(url);
	if (urlsHas) return true;

	// extract image_id from R2 URL patterns:
	// - https://pub-*.r2.dev/{image_id}.{ext}
	// - https://cdn.plyr.fm/images/{image_id}.{ext}
	const r2Match = url.match(/r2\.dev\/([^/.]+)\./);
	if (r2Match) {
		const hasR2 = Array.isArray(data.image_ids)
			? data.image_ids.includes(r2Match[1])
			: data.image_ids.has(r2Match[1]);
		if (hasR2) return true;
	}

	const cdnMatch = url.match(/\/images\/([^/.]+)\./);
	if (cdnMatch) {
		const hasCdn = Array.isArray(data.image_ids)
			? data.image_ids.includes(cdnMatch[1])
			: data.image_ids.has(cdnMatch[1]);
		if (hasCdn) return true;
	}

	return false;
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
		return checkImageSensitive(url, this.data);
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
