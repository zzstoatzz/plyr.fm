// user preferences state management
import { browser } from '$app/environment';
import { API_URL } from '$lib/config';
import { auth } from '$lib/auth.svelte';

export type Theme = 'dark' | 'light' | 'system';

export interface Preferences {
	accent_color: string | null;
	auto_advance: boolean;
	allow_comments: boolean;
	hidden_tags: string[];
	theme: Theme;
}

const DEFAULT_PREFERENCES: Preferences = {
	accent_color: null,
	auto_advance: true,
	allow_comments: true,
	hidden_tags: ['ai'],
	theme: 'dark'
};

class PreferencesManager {
	data = $state<Preferences | null>(null);
	loading = $state(false);
	private initialized = false;

	get loaded(): boolean {
		return this.data !== null;
	}

	get hiddenTags(): string[] {
		return this.data?.hidden_tags ?? DEFAULT_PREFERENCES.hidden_tags;
	}

	get accentColor(): string | null {
		return this.data?.accent_color ?? null;
	}

	get autoAdvance(): boolean {
		return this.data?.auto_advance ?? DEFAULT_PREFERENCES.auto_advance;
	}

	get allowComments(): boolean {
		return this.data?.allow_comments ?? DEFAULT_PREFERENCES.allow_comments;
	}

	get theme(): Theme {
		return this.data?.theme ?? DEFAULT_PREFERENCES.theme;
	}

	setTheme(theme: Theme): void {
		if (browser) {
			localStorage.setItem('theme', theme);
			this.applyTheme(theme);
		}
		this.update({ theme });
	}

	applyTheme(theme: Theme): void {
		if (!browser) return;
		const root = document.documentElement;
		root.classList.remove('theme-dark', 'theme-light');

		let effectiveTheme: 'dark' | 'light';
		if (theme === 'system') {
			effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		} else {
			effectiveTheme = theme;
		}
		root.classList.add(`theme-${effectiveTheme}`);
	}

	async initialize(): Promise<void> {
		if (!browser || this.initialized || this.loading) return;
		this.initialized = true;
		await this.fetch();
	}

	async fetch(): Promise<void> {
		if (!browser || !auth.isAuthenticated) return;

		this.loading = true;
		try {
			const response = await fetch(`${API_URL}/preferences/`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				this.data = {
					accent_color: data.accent_color ?? null,
					auto_advance: data.auto_advance ?? DEFAULT_PREFERENCES.auto_advance,
					allow_comments: data.allow_comments ?? DEFAULT_PREFERENCES.allow_comments,
					hidden_tags: data.hidden_tags ?? DEFAULT_PREFERENCES.hidden_tags,
					theme: data.theme ?? DEFAULT_PREFERENCES.theme
				};
			} else {
				this.data = { ...DEFAULT_PREFERENCES };
			}
			// apply theme after fetching
			if (browser) {
				this.applyTheme(this.data.theme);
			}
		} catch (error) {
			console.error('failed to fetch preferences:', error);
			this.data = { ...DEFAULT_PREFERENCES };
		} finally {
			this.loading = false;
		}
	}

	async update(updates: Partial<Preferences>): Promise<void> {
		if (!browser || !auth.isAuthenticated) return;

		// optimistic update
		if (this.data) {
			this.data = { ...this.data, ...updates };
		}

		try {
			await fetch(`${API_URL}/preferences/`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify(updates)
			});
		} catch (error) {
			console.error('failed to save preferences:', error);
			// revert on error by refetching
			await this.fetch();
		}
	}

	clear(): void {
		this.data = null;
		this.initialized = false;
	}
}

export const preferences = new PreferencesManager();
