import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HINTS, hintSeen, markHintSeen } from './hints.svelte';
import { auth } from '$lib/auth.svelte';
import { DEFAULT_PREFERENCES, preferences } from '$lib/preferences.svelte';
import { safeLocalStorage } from '$lib/utils/safe-storage';

describe('hints', () => {
	afterEach(() => {
		auth.isAuthenticated = false;
		preferences.data = null;
		safeLocalStorage.removeItem(`hint-seen:${HINTS.queueSwipe}`);
		vi.restoreAllMocks();
	});

	describe('signed out', () => {
		it('is unseen until marked, on this device only', async () => {
			expect(hintSeen(HINTS.queueSwipe)).toBe(false);
			await markHintSeen(HINTS.queueSwipe);
			expect(hintSeen(HINTS.queueSwipe)).toBe(true);
		});
	});

	describe('signed in', () => {
		beforeEach(() => {
			auth.isAuthenticated = true;
			preferences.data = { ...DEFAULT_PREFERENCES, ui_settings: {} };
		});

		it('reads only the account preferences, never the device record', async () => {
			safeLocalStorage.setItem(`hint-seen:${HINTS.queueSwipe}`, '1');
			expect(hintSeen(HINTS.queueSwipe)).toBe(false);
		});

		it('marks seen through ui_settings and is idempotent', async () => {
			const update = vi
				.spyOn(preferences, 'updateUiSettings')
				.mockImplementation(async (updates) => {
					if (preferences.data) {
						preferences.data = {
							...preferences.data,
							ui_settings: { ...preferences.data.ui_settings, ...updates }
						};
					}
				});
			await markHintSeen(HINTS.queueSwipe);
			expect(update).toHaveBeenCalledWith({ seen_hints: [HINTS.queueSwipe] });
			expect(hintSeen(HINTS.queueSwipe)).toBe(true);
			await markHintSeen(HINTS.queueSwipe);
			expect(update).toHaveBeenCalledTimes(1);
		});

		it('a version bump re-shows the hint', () => {
			preferences.data = {
				...DEFAULT_PREFERENCES,
				ui_settings: { seen_hints: ['queue-swipe@0'] }
			};
			expect(hintSeen(HINTS.queueSwipe)).toBe(false);
		});
	});
});
