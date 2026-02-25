/**
 * playback helper - guards queue operations with gated content checks.
 *
 * all playback actions should go through this module to prevent
 * gated tracks from interrupting current playback.
 */

import { browser } from '$app/environment';
import { queue } from './queue.svelte';
import { toast } from './toast.svelte';
import { API_URL, getAtprotofansSupportUrl } from './config';
import type { Track } from './types';

interface GatedCheckResult {
	allowed: boolean;
	requiresAuth?: boolean;
	artistDid?: string;
	artistHandle?: string;
}

/**
 * check if a track can be played by the current user.
 * returns immediately for non-gated tracks.
 * for gated tracks, makes a HEAD request to verify access.
 */
async function checkAccess(track: Track): Promise<GatedCheckResult> {
	// non-gated tracks are always allowed
	if (!track.gated) {
		return { allowed: true };
	}

	// gated track - check access via HEAD request
	try {
		const response = await fetch(`${API_URL}/audio/${track.file_id}`, {
			method: 'HEAD',
			credentials: 'include'
		});

		if (response.ok) {
			return { allowed: true };
		}

		if (response.status === 401) {
			return {
				allowed: false,
				requiresAuth: true,
				artistDid: track.artist_did,
				artistHandle: track.artist_handle
			};
		}

		if (response.status === 402) {
			return {
				allowed: false,
				requiresAuth: false,
				artistDid: track.artist_did,
				artistHandle: track.artist_handle
			};
		}

		// unexpected status - allow and let Player handle any errors
		return { allowed: true };
	} catch {
		// network error - allow and let Player handle any errors
		return { allowed: true };
	}
}

/**
 * show appropriate toast for denied access (from HEAD request).
 */
function showDeniedToast(result: GatedCheckResult): void {
	if (result.requiresAuth) {
		toast.info('sign in to play supporter-only tracks');
	} else if (result.artistDid) {
		toast.info('this track is for supporters only', 5000, {
			label: 'become a supporter',
			href: getAtprotofansSupportUrl(result.artistDid)
		});
	} else {
		toast.info('this track is for supporters only');
	}
}

/**
 * show toast for gated track (using server-resolved status).
 */
function showGatedToast(track: Track, isAuthenticated: boolean): void {
	if (!isAuthenticated) {
		toast.info('sign in to play supporter-only tracks');
	} else if (track.artist_did) {
		toast.info('this track is for supporters only', 5000, {
			label: 'become a supporter',
			href: getAtprotofansSupportUrl(track.artist_did)
		});
	} else {
		toast.info('this track is for supporters only');
	}
}

/**
 * check if track is accessible using server-resolved gated status.
 * shows toast if denied. no network call - instant feedback.
 * use this for queue adds and other non-playback operations.
 */
export function guardGatedTrack(track: Track, isAuthenticated: boolean): boolean {
	if (!track.gated) return true;
	showGatedToast(track, isAuthenticated);
	return false;
}

/**
 * play a single track now.
 * checks gated access before modifying queue state.
 * shows toast if access denied - does NOT interrupt current playback.
 */
export async function playTrack(track: Track): Promise<boolean> {
	if (!browser) return false;

	const result = await checkAccess(track);
	if (!result.allowed) {
		showDeniedToast(result);
		return false;
	}

	queue.playNow(track);
	return true;
}

/**
 * set the queue and optionally start playing at a specific index.
 * checks gated access for the starting track before modifying queue state.
 */
export async function playQueue(tracks: Track[], startIndex = 0): Promise<boolean> {
	if (!browser || tracks.length === 0) return false;

	const startTrack = tracks[startIndex];
	if (!startTrack) return false;

	const result = await checkAccess(startTrack);
	if (!result.allowed) {
		showDeniedToast(result);
		return false;
	}

	queue.setQueue(tracks, startIndex);
	return true;
}

/**
 * add tracks to queue and optionally start playing.
 * if playNow is true, checks gated access for the first added track.
 */
export async function addToQueue(tracks: Track[], playNow = false): Promise<boolean> {
	if (!browser || tracks.length === 0) return false;

	if (playNow) {
		const result = await checkAccess(tracks[0]);
		if (!result.allowed) {
			showDeniedToast(result);
			return false;
		}
	}

	queue.addTracks(tracks, playNow);
	return true;
}

/**
 * go to a specific index in the queue.
 * checks gated access before changing position.
 */
export async function goToIndex(index: number): Promise<boolean> {
	if (!browser) return false;

	const track = queue.tracks[index];
	if (!track) return false;

	const result = await checkAccess(track);
	if (!result.allowed) {
		showDeniedToast(result);
		return false;
	}

	queue.goTo(index);
	return true;
}
