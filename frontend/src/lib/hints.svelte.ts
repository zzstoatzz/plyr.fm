import { auth } from '$lib/auth.svelte';
import { preferences } from '$lib/preferences.svelte';
import { safeLocalStorage } from '$lib/utils/safe-storage';

/**
 * one-time, versioned UI hints. each hint is an `id@version` string; bumping
 * the version re-shows the hint after the mechanism it describes changes.
 * signed-in accounts persist seen hints in server-side preferences
 * (`ui_settings.seen_hints`), so they follow the account; signed-out visitors
 * get a device-local record, never read back once signed in.
 */
export const HINTS = {
	queueSwipe: 'queue-swipe@1'
} as const;

export type Hint = (typeof HINTS)[keyof typeof HINTS];

const LOCAL_PREFIX = 'hint-seen:';

export function hintSeen(hint: Hint): boolean {
	if (auth.isAuthenticated) {
		return preferences.data?.ui_settings?.seen_hints?.includes(hint) ?? false;
	}
	return safeLocalStorage.getItem(`${LOCAL_PREFIX}${hint}`) === '1';
}

export async function markHintSeen(hint: Hint): Promise<void> {
	if (auth.isAuthenticated) {
		if (hintSeen(hint)) return;
		const seen = preferences.data?.ui_settings?.seen_hints ?? [];
		await preferences.updateUiSettings({ seen_hints: [...seen, hint] });
		return;
	}
	safeLocalStorage.setItem(`${LOCAL_PREFIX}${hint}`, '1');
}
