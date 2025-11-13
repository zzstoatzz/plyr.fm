// auth state management using Svelte 5 runes
import { browser } from '$app/environment';
import { API_URL } from '$lib/config';
import type { User } from '$lib/types';

export interface AuthState {
	user: User | null;
	isAuthenticated: boolean;
	loading: boolean;
}

class AuthManager {
	user = $state<User | null>(null);
	isAuthenticated = $state(false);
	loading = $state(true);

	async initialize(): Promise<void> {
		if (!browser) {
			this.loading = false;
			return;
		}

		const sessionId = this.getSessionId();
		if (!sessionId) {
			this.loading = false;
			return;
		}

		try {
			const response = await fetch(`${API_URL}/auth/me`, {
				headers: {
					'Authorization': `Bearer ${sessionId}`
				}
			});

			if (response.ok) {
				this.user = await response.json();
				this.isAuthenticated = true;
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

	getSessionId(): string | null {
		if (!browser) return null;
		return localStorage.getItem('session_id');
	}

	setSessionId(sessionId: string): void {
		if (!browser) return;
		localStorage.setItem('session_id', sessionId);
	}

	clearSession(): void {
		if (!browser) return;
		localStorage.removeItem('session_id');
		localStorage.removeItem('exchange_token');
		this.user = null;
		this.isAuthenticated = false;
	}

	async logout(): Promise<void> {
		const sessionId = this.getSessionId();
		if (sessionId) {
			try {
				await fetch(`${API_URL}/auth/logout`, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${sessionId}`
					}
				});
			} catch (e) {
				console.error('logout failed:', e);
			}
		}
		this.clearSession();
	}

	// helper to get auth headers
	getAuthHeaders(): Record<string, string> {
		const sessionId = this.getSessionId();
		if (sessionId) {
			return { 'Authorization': `Bearer ${sessionId}` };
		}
		return {};
	}
}

export const auth = new AuthManager();
