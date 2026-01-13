/**
 * global avatar refresh system.
 *
 * when any avatar fails to load (404/stale URL), trigger a background refresh
 * from Bluesky. the refreshed URL is cached globally so all components showing
 * that avatar will update.
 *
 * usage:
 *   import { getRefreshedAvatar, triggerAvatarRefresh } from '$lib/avatar-refresh.svelte';
 *
 *   const refreshedUrl = $derived(getRefreshedAvatar(did));
 *   const displayUrl = $derived(refreshedUrl ?? originalAvatarUrl);
 *
 *   function handleError() {
 *     avatarError = true;
 *     triggerAvatarRefresh(did);
 *   }
 */

import { API_URL } from './config';

// map of DID -> refreshed avatar URL (string or null if no avatar)
let refreshedAvatars = $state<Map<string, string | null>>(new Map());

// DIDs currently being refreshed (to avoid duplicate requests)
const refreshingDids = new Set<string>();

// DIDs that have been attempted (to avoid repeated failures)
const attemptedDids = new Set<string>();

/**
 * get the refreshed avatar URL for a DID.
 * returns the refreshed URL, or null if not available/not yet refreshed.
 */
export function getRefreshedAvatar(did: string | undefined): string | null {
	if (!did) return null;
	return refreshedAvatars.get(did) ?? null;
}

/**
 * check if we've already attempted to refresh this DID.
 * (either succeeded, failed, or currently in progress)
 */
export function hasAttemptedRefresh(did: string | undefined): boolean {
	if (!did) return true; // treat missing DID as "already attempted"
	return attemptedDids.has(did) || refreshingDids.has(did);
}

/**
 * trigger a background refresh of an avatar from Bluesky.
 * safe to call multiple times - will dedupe requests.
 *
 * @param did - the user's DID
 * @returns promise that resolves when refresh completes (or immediately if skipped)
 */
export async function triggerAvatarRefresh(did: string | undefined): Promise<void> {
	if (!did) return;

	// skip if already refreshed, attempted, or in progress
	if (refreshedAvatars.has(did) || attemptedDids.has(did) || refreshingDids.has(did)) {
		return;
	}

	refreshingDids.add(did);

	try {
		const response = await fetch(`${API_URL}/artists/${did}/refresh-avatar`, {
			method: 'POST'
		});

		if (response.ok) {
			const data = await response.json();
			// create new map to trigger reactivity
			const newMap = new Map(refreshedAvatars);
			newMap.set(did, data.avatar_url || null);
			refreshedAvatars = newMap;
		} else {
			// mark as attempted even on failure (don't retry 404s etc)
			attemptedDids.add(did);
		}
	} catch {
		// silently fail - mark as attempted so we don't retry
		attemptedDids.add(did);
	} finally {
		refreshingDids.delete(did);
		attemptedDids.add(did);
	}
}

/**
 * manually set a refreshed avatar URL.
 * useful when you've already fetched the URL elsewhere (e.g., profile page).
 */
export function setRefreshedAvatar(did: string, url: string | null): void {
	const newMap = new Map(refreshedAvatars);
	newMap.set(did, url);
	refreshedAvatars = newMap;
	attemptedDids.add(did);
}

/**
 * clear the refresh cache. mainly for testing.
 */
export function clearAvatarCache(): void {
	refreshedAvatars = new Map();
	refreshingDids.clear();
	attemptedDids.clear();
}
