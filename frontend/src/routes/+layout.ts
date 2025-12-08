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
	show_sensitive_artwork: false,
	show_liked_on_profile: false,
	support_url: null
};

export async function load({ fetch, data }: LoadEvent): Promise<LayoutData> {
	const sensitiveImages = data?.sensitiveImages ?? { image_ids: [], urls: [] };

	if (!browser) {
		return {
			user: null,
			isAuthenticated: false,
			preferences: null,
			sensitiveImages
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
					const prefsData = await prefsResponse.json();
					preferences = {
						accent_color: prefsData.accent_color ?? null,
						auto_advance: prefsData.auto_advance ?? true,
						allow_comments: prefsData.allow_comments ?? true,
						hidden_tags: prefsData.hidden_tags ?? ['ai'],
						theme: prefsData.theme ?? 'dark',
						enable_teal_scrobbling: prefsData.enable_teal_scrobbling ?? false,
						teal_needs_reauth: prefsData.teal_needs_reauth ?? false,
						show_sensitive_artwork: prefsData.show_sensitive_artwork ?? false,
						show_liked_on_profile: prefsData.show_liked_on_profile ?? false,
						support_url: prefsData.support_url ?? null
					};
				}
			} catch (e) {
				console.error('preferences fetch failed:', e);
			}

			return {
				user,
				isAuthenticated: true,
				preferences,
				sensitiveImages
			};
		}
	} catch (e) {
		console.error('auth check failed:', e);
	}

	return {
		user: null,
		isAuthenticated: false,
		preferences: null,
		sensitiveImages
	};
}
