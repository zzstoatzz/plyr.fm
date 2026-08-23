// sessionStorage stash for the track upload form, used when an auth check
// before submit detects an expired session. the page redirects to /login and
// rehydrates the form on return so the user doesn't lose what they typed.
//
// File objects can't be serialized — audio + cover art are deliberately
// excluded. the user has to reattach them after sign-in; the upload page
// surfaces this with a toast.

import { API_URL } from '$lib/config';
import type { FeaturedArtist } from '$lib/types';
import { safeSessionStorage } from '$lib/utils/safe-storage';

const STASH_KEY = 'plyr_upload_track_form_stash';

export interface TrackFormStash {
	title: string;
	albumTitle: string;
	description: string;
	featuredArtists: FeaturedArtist[];
	uploadTags: string[];
	attestedRights: boolean;
	autoTag: boolean;
	sensitiveAudio?: boolean;
	// single visibility value (public | unlisted | supporters | private) — the
	// draft must survive a private-media scope-upgrade redirect with its choice intact.
	visibility: string;
}

export function stashTrackForm(state: TrackFormStash): void {
	safeSessionStorage.setItem(STASH_KEY, JSON.stringify(state));
}

/** the parsed stash, or null when it isn't the shape this module writes. */
function parseTrackFormStash(raw: string): TrackFormStash | null {
	const parsed: Partial<TrackFormStash> | null = JSON.parse(raw);
	if (!parsed || !Array.isArray(parsed.featuredArtists) || !Array.isArray(parsed.uploadTags)) {
		return null;
	}
	return {
		title: parsed.title ?? '',
		albumTitle: parsed.albumTitle ?? '',
		description: parsed.description ?? '',
		featuredArtists: parsed.featuredArtists,
		uploadTags: parsed.uploadTags,
		attestedRights: parsed.attestedRights ?? false,
		autoTag: parsed.autoTag ?? false,
		sensitiveAudio: parsed.sensitiveAudio,
		visibility: parsed.visibility ?? 'public'
	};
}

export function restoreTrackForm(): TrackFormStash | null {
	try {
		const raw = safeSessionStorage.getItem(STASH_KEY);
		if (!raw) return null;
		// if a future schema bump renders the stash unreadable, drop it rather than crash the page
		return parseTrackFormStash(raw);
	} catch {
		return null;
	}
}

export function clearTrackFormStash(): void {
	safeSessionStorage.removeItem(STASH_KEY);
}

/**
 * pre-flight auth status used before destructive upload actions.
 *
 * - `ok`: session is still valid; proceed with upload
 * - `expired`: server says we're not authenticated (401/403); stash the form
 *   and redirect to login
 * - `unverified`: we couldn't reach the auth endpoint (network error / 5xx);
 *   don't redirect (the session may still be fine), but also don't proceed
 *   (the upload would fail anyway). caller surfaces a "try again" toast.
 *
 * intentionally distinct from `auth.refresh()` — refresh treats network
 * failures as session loss, which would bounce healthy users to /login on
 * any transient blip.
 */
export type PreflightAuthResult = 'ok' | 'expired' | 'unverified';

export async function preflightAuth(): Promise<PreflightAuthResult> {
	try {
		const response = await fetch(`${API_URL}/auth/me`, {
			credentials: 'include',
		});
		if (response.ok) return 'ok';
		if (response.status === 401 || response.status === 403) return 'expired';
		return 'unverified';
	} catch {
		return 'unverified';
	}
}
