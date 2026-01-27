// global feedback modal state using Svelte 5 runes
import { API_URL } from '$lib/config';
import type { SearchResult } from '$lib/search.svelte';

export type FeedbackMode = 'select' | 'bug' | 'content';
export type ReportReason = 'copyright' | 'abuse' | 'spam' | 'explicit' | 'other';

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
	{ value: 'copyright', label: 'copyright infringement' },
	{ value: 'abuse', label: 'abuse or harassment' },
	{ value: 'spam', label: 'spam' },
	{ value: 'explicit', label: 'explicit content' },
	{ value: 'other', label: 'other' }
];

const MAX_DESCRIPTION_LENGTH = 1000;

class FeedbackState {
	isOpen = $state(false);
	mode = $state<FeedbackMode>('select');

	// content report state
	searchQuery = $state('');
	searchResults = $state<SearchResult[]>([]);
	searchLoading = $state(false);
	selectedEntity = $state<SearchResult | null>(null);
	reason = $state<ReportReason | ''>('');
	description = $state('');
	screenshotUrl = $state<string | null>(null);

	isSubmitting = $state(false);
	error = $state<string | null>(null);
	successMessage = $state<string | null>(null);

	// debounce timer for search
	private searchTimeout: ReturnType<typeof setTimeout> | null = null;

	open() {
		this.isOpen = true;
		this.mode = 'select';
		this.reset();
	}

	close() {
		this.isOpen = false;
		this.reset();
	}

	reset() {
		this.searchQuery = '';
		this.searchResults = [];
		this.searchLoading = false;
		this.selectedEntity = null;
		this.reason = '';
		this.description = '';
		this.screenshotUrl = null;
		this.isSubmitting = false;
		this.error = null;
		this.successMessage = null;
		if (this.searchTimeout) {
			clearTimeout(this.searchTimeout);
			this.searchTimeout = null;
		}
	}

	setMode(mode: FeedbackMode) {
		this.mode = mode;
		if (mode === 'bug') {
			// open github issues in new tab
			window.open('https://github.com/zzstoatzz/plyr.fm/issues/new', '_blank');
			this.close();
		}
	}

	setSearchQuery(value: string) {
		this.searchQuery = value;
		this.error = null;

		if (this.searchTimeout) {
			clearTimeout(this.searchTimeout);
		}

		if (value.length >= 2) {
			this.searchTimeout = setTimeout(() => {
				void this.searchEntities(value);
			}, 150);
		} else {
			this.searchResults = [];
		}
	}

	async searchEntities(query: string): Promise<void> {
		if (query.length < 2) return;

		this.searchLoading = true;

		try {
			const response = await fetch(
				`${API_URL}/search/?q=${encodeURIComponent(query)}&limit=8`
			);

			if (!response.ok) {
				throw new Error(`search failed: ${response.statusText}`);
			}

			const data = await response.json();
			this.searchResults = data.results;
		} catch (e) {
			console.error('search error:', e);
			this.searchResults = [];
		} finally {
			this.searchLoading = false;
		}
	}

	selectEntity(entity: SearchResult) {
		this.selectedEntity = entity;
		this.searchQuery = '';
		this.searchResults = [];
	}

	clearSelectedEntity() {
		this.selectedEntity = null;
	}

	setReason(reason: ReportReason) {
		this.reason = reason;
	}

	setDescription(value: string) {
		if (value.length <= MAX_DESCRIPTION_LENGTH) {
			this.description = value;
		}
	}

	getEntityId(entity: SearchResult): string {
		switch (entity.type) {
			case 'track':
				return String(entity.id);
			case 'artist':
				return entity.did;
			case 'album':
				return entity.id;
			case 'tag':
				return String(entity.id);
			case 'playlist':
				return entity.id;
		}
	}

	getEntityDisplayName(entity: SearchResult): string {
		switch (entity.type) {
			case 'track':
				return `"${entity.title}" by ${entity.artist_display_name || entity.artist_handle}`;
			case 'artist':
				return `@${entity.handle}`;
			case 'album':
				return `"${entity.title}" by ${entity.artist_display_name || entity.artist_handle}`;
			case 'tag':
				return `#${entity.name}`;
			case 'playlist':
				return `"${entity.name}" by ${entity.owner_display_name || entity.owner_handle}`;
		}
	}

	getEntityUrl(entity: SearchResult): string {
		switch (entity.type) {
			case 'track':
				return `/track/${entity.id}`;
			case 'artist':
				return `/u/${entity.handle}`;
			case 'album':
				return `/u/${entity.artist_handle}/album/${entity.slug}`;
			case 'tag':
				return `/tag/${entity.name}`;
			case 'playlist':
				return `/playlist/${entity.id}`;
		}
	}

	canSubmit(): boolean {
		return (
			this.selectedEntity !== null &&
			this.reason !== '' &&
			!this.isSubmitting
		);
	}

	async submitReport(): Promise<boolean> {
		if (!this.canSubmit() || !this.selectedEntity) {
			return false;
		}

		this.isSubmitting = true;
		this.error = null;

		try {
			const response = await fetch(`${API_URL}/moderation/reports`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify({
					target_type: this.selectedEntity.type,
					target_id: this.getEntityId(this.selectedEntity),
					target_name: this.getEntityDisplayName(this.selectedEntity),
					target_url: this.getEntityUrl(this.selectedEntity),
					reason: this.reason,
					description: this.description || null,
					screenshot_url: this.screenshotUrl
				})
			});

			if (!response.ok) {
				const data = await response.json().catch(() => ({}));
				throw new Error(data.detail || `failed to submit report: ${response.statusText}`);
			}

			this.successMessage = 'report submitted. thank you for helping keep plyr.fm safe.';

			// close modal after short delay to show success message
			setTimeout(() => {
				this.close();
			}, 2000);

			return true;
		} catch (e) {
			console.error('report submission error:', e);
			this.error = e instanceof Error ? e.message : 'failed to submit report';
			return false;
		} finally {
			this.isSubmitting = false;
		}
	}
}

export const feedback = new FeedbackState();
