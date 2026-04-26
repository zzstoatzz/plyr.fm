// sessionStorage stash for the track upload form, used when an auth check
// before submit detects an expired session. the page redirects to /login and
// rehydrates the form on return so the user doesn't lose what they typed.
//
// File objects can't be serialized — audio + cover art are deliberately
// excluded. the user has to reattach them after sign-in; the upload page
// surfaces this with a toast.

import { API_URL } from '$lib/config';
import type { FeaturedArtist } from '$lib/types';

const STASH_KEY = 'plyr_upload_track_form_stash';

export interface TrackFormStash {
	title: string;
	albumTitle: string;
	description: string;
	featuredArtists: FeaturedArtist[];
	uploadTags: string[];
	attestedRights: boolean;
	supportGated: boolean;
	autoTag: boolean;
	trackUnlisted: boolean;
}

export function stashTrackForm(state: TrackFormStash): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(STASH_KEY, JSON.stringify(state));
	} catch {
		// sessionStorage disabled / quota exceeded — fail silently;
		// worst case we lose the draft, which matches today's behavior.
	}
}

export function restoreTrackForm(): TrackFormStash | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(STASH_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		// minimal shape check — if a future schema bump renders the stash
		// unreadable, drop it rather than crash the page.
		if (typeof parsed !== 'object' || parsed === null) return null;
		return parsed as TrackFormStash;
	} catch {
		return null;
	}
}

export function clearTrackFormStash(): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.removeItem(STASH_KEY);
	} catch {
		// ignore
	}
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
