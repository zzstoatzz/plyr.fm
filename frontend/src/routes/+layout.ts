import { browser } from '$app/environment';
import { API_URL } from '$lib/config';
import type { User } from '$lib/types';
import type { Preferences } from '$lib/preferences.svelte';
import type { SensitiveImagesData } from '$lib/moderation.svelte';
import type { LoadEvent } from '@sveltejs/kit';

export interface LayoutData {
	user: User | null;
	isAuthenticated: boolean;
	preferences: Preferences | null;
	sensitiveImages: SensitiveImagesData;
}

const DEFAULT_PREFERENCES: Preferences = {
	accent_color: null,
	auto_advance: true,
	allow_comments: true,
	hidden_tags: ['ai'],
	theme: 'dark',
	enable_teal_scrobbling: false,
	teal_needs_reauth: false,
	show_sensitive_artwork: false
};

export async function load({ fetch, parent }: LoadEvent): Promise<LayoutData> {
	// get server-loaded data (sensitiveImages)
	const parentData = await parent();

	if (!browser) {
		return {
			user: null,
			isAuthenticated: false,
			preferences: null,
			sensitiveImages: parentData.sensitiveImages ?? { image_ids: [], urls: [] }
		};
	}

	try {
		const response = await fetch(`${API_URL}/auth/me`, {
			credentials: 'include'
		});

		if (response.ok) {
			const user = await response.json();

			// fetch preferences in parallel once we know user is authenticated
			let preferences: Preferences = { ...DEFAULT_PREFERENCES };
			try {
				const prefsResponse = await fetch(`${API_URL}/preferences/`, {
					credentials: 'include'
				});
				if (prefsResponse.ok) {
					const data = await prefsResponse.json();
					preferences = {
						accent_color: data.accent_color ?? null,
						auto_advance: data.auto_advance ?? true,
						allow_comments: data.allow_comments ?? true,
						hidden_tags: data.hidden_tags ?? ['ai'],
						theme: data.theme ?? 'dark',
						enable_teal_scrobbling: data.enable_teal_scrobbling ?? false,
						teal_needs_reauth: data.teal_needs_reauth ?? false,
						show_sensitive_artwork: data.show_sensitive_artwork ?? false
					};
				}
			} catch (e) {
				console.error('preferences fetch failed:', e);
			}

			return {
				user,
				isAuthenticated: true,
				preferences,
				sensitiveImages: parentData.sensitiveImages ?? { image_ids: [], urls: [] }
			};
		}
	} catch (e) {
		console.error('auth check failed:', e);
	}

	return {
		user: null,
		isAuthenticated: false,
		preferences: null,
		sensitiveImages: parentData.sensitiveImages ?? { image_ids: [], urls: [] }
	};
}
