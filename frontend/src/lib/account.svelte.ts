// account-level actions (terms acceptance, account deletion, etc.)
import { browser } from '$app/environment';
import { API_URL } from '$lib/config';
import { auth } from '$lib/auth.svelte';
import { preferences } from '$lib/preferences.svelte';

class AccountManager {
	async acceptTerms(): Promise<boolean> {
		if (!browser || !auth.isAuthenticated) return false;

		try {
			const response = await fetch(`${API_URL}/account/accept-terms`, {
				method: 'POST',
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				// update preferences state so UI reacts
				if (preferences.data) {
					preferences.data = { ...preferences.data, terms_accepted_at: data.terms_accepted_at };
				}
				return true;
			}
			return false;
		} catch (error) {
			console.error('failed to accept terms:', error);
			return false;
		}
	}
}

export const account = new AccountManager();
