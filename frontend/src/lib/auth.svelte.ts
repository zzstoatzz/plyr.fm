// auth state management using Svelte 5 runes
import { browser } from '$app/environment';
import { API_URL } from '$lib/config';
import { toast } from '$lib/toast.svelte';
import type { User } from '$lib/types';

export interface AuthState {
	user: User | null;
	isAuthenticated: boolean;
	loading: boolean;
	scopeUpgradeRequired: boolean;
}

class AuthManager {
	user = $state<User | null>(null);
	isAuthenticated = $state(false);
	loading = $state(true);
	scopeUpgradeRequired = $state(false);
	private initialized = false;

	async initialize(): Promise<void> {
		if (!browser) {
			this.loading = false;
			return;
		}

		// only fetch once - subsequent calls are no-ops
		if (this.initialized) {
			return;
		}
		this.initialized = true;

		try {
			const response = await fetch(`${API_URL}/auth/me`, {
				credentials: 'include'
			});

			if (response.ok) {
				this.user = await response.json();
				this.isAuthenticated = true;
				this.scopeUpgradeRequired = false;
			} else if (response.status === 403) {
				// check if this is a scope upgrade requirement
				const data = await response.json().catch(() => ({}));
				if (data.detail === 'scope_upgrade_required') {
					this.scopeUpgradeRequired = true;
					this.clearSession();
					toast.info(
						"plyr.fm's permissions have changed since you logged in. please log in again",
						5000,
						{ label: 'see changes', href: 'https://github.com/zzstoatzz/plyr.fm/releases/latest' }
					);
				} else {
					this.clearSession();
				}
			} else {
				this.clearSession();
			}
		} catch (e) {
			console.error('auth check failed:', e);
			this.clearSession();
		} finally {
			this.loading = false;
		}
	}

	clearSession(): void {
		if (!browser) return;
		this.user = null;
		this.isAuthenticated = false;
		this.initialized = false;
	}

	async refresh(): Promise<void> {
		this.initialized = false;
		await this.initialize();
	}

	async logout(): Promise<void> {
		try {
			await fetch(`${API_URL}/auth/logout`, {
				method: 'POST',
				credentials: 'include'
			});
		} catch (e) {
			console.error('logout failed:', e);
		}
		this.clearSession();
	}

	getAuthHeaders(): Record<string, string> {
		return {};
	}
}

export const auth = new AuthManager();
