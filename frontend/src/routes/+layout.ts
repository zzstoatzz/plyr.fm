import { browser } from '$app/environment';
import { API_URL } from '$lib/config';
import type { User } from '$lib/types';
import type { LoadEvent } from '@sveltejs/kit';

export interface LayoutData {
	user: User | null;
	isAuthenticated: boolean;
}

export async function load({ fetch }: LoadEvent): Promise<LayoutData> {
	if (!browser) {
		return {
			user: null,
			isAuthenticated: false
		};
	}

	const sessionId = localStorage.getItem('session_id');
	if (!sessionId) {
		return {
			user: null,
			isAuthenticated: false
		};
	}

	try {
		const response = await fetch(`${API_URL}/auth/me`, {
			headers: {
				'Authorization': `Bearer ${sessionId}`
			}
		});

		if (response.ok) {
			const user = await response.json();
			return {
				user,
				isAuthenticated: true
			};
		}
	} catch (e) {
		console.error('auth check failed:', e);
	}

	return {
		user: null,
		isAuthenticated: false
	};
}
