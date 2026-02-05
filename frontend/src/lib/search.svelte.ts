// global search state using Svelte 5 runes
import { API_URL } from '$lib/config';

export type SearchResultType = 'track' | 'artist' | 'album' | 'tag' | 'playlist';

export interface TrackSearchResult {
	type: 'track';
	id: number;
	title: string;
	artist_handle: string;
	artist_display_name: string;
	image_url: string | null;
	relevance: number;
}

export interface ArtistSearchResult {
	type: 'artist';
	did: string;
	handle: string;
	display_name: string;
	avatar_url: string | null;
	relevance: number;
}

export interface AlbumSearchResult {
	type: 'album';
	id: string;
	title: string;
	slug: string;
	artist_handle: string;
	artist_display_name: string;
	image_url: string | null;
	relevance: number;
}

export interface TagSearchResult {
	type: 'tag';
	id: number;
	name: string;
	track_count: number;
	relevance: number;
}

export interface PlaylistSearchResult {
	type: 'playlist';
	id: string;
	name: string;
	owner_handle: string;
	owner_display_name: string;
	image_url: string | null;
	track_count: number;
	relevance: number;
}

export type SearchResult =
	| TrackSearchResult
	| ArtistSearchResult
	| AlbumSearchResult
	| TagSearchResult
	| PlaylistSearchResult;

export interface SemanticSearchResult {
	type: 'track';
	id: number;
	title: string;
	artist_handle: string;
	artist_display_name: string;
	image_url: string | null;
	similarity: number;
}

export interface SemanticSearchResponse {
	results: SemanticSearchResult[];
	query: string;
}

export interface SearchResponse {
	results: SearchResult[];
	counts: {
		tracks: number;
		artists: number;
		albums: number;
		tags: number;
		playlists: number;
	};
}

const MAX_QUERY_LENGTH = 100;

class SearchState {
	isOpen = $state(false);
	query = $state('');
	results = $state<SearchResult[]>([]);
	counts = $state<SearchResponse['counts']>({ tracks: 0, artists: 0, albums: 0, tags: 0, playlists: 0 });
	loading = $state(false);
	error = $state<string | null>(null);
	selectedIndex = $state(0);

	// semantic search state
	semanticMode = $state(false);
	semanticResults = $state<SemanticSearchResult[]>([]);

	// reference to input element for direct focus (mobile keyboard workaround)
	inputRef: HTMLInputElement | null = null;

	// debounce timer
	private searchTimeout: ReturnType<typeof setTimeout> | null = null;

	setInputRef(el: HTMLInputElement | null) {
		this.inputRef = el;
	}

	open() {
		// focus input FIRST (before state change) for mobile keyboard to open
		// iOS/mobile browsers only open keyboard when focus() is in direct user gesture
		if (this.inputRef) {
			this.inputRef.focus();
		}
		this.isOpen = true;
		this.query = '';
		this.results = [];
		this.semanticResults = [];
		this.counts = { tracks: 0, artists: 0, albums: 0, tags: 0, playlists: 0 };
		this.error = null;
		this.selectedIndex = 0;
	}

	close() {
		this.isOpen = false;
		this.query = '';
		this.results = [];
		this.semanticResults = [];
		this.error = null;
		if (this.searchTimeout) {
			clearTimeout(this.searchTimeout);
			this.searchTimeout = null;
		}
	}

	toggle() {
		if (this.isOpen) {
			this.close();
		} else {
			this.open();
		}
	}

	toggleSemanticMode() {
		this.semanticMode = !this.semanticMode;
		this.results = [];
		this.semanticResults = [];
		this.selectedIndex = 0;
		this.error = null;
		// re-search with current query if it meets the threshold
		if (this.query.length >= (this.semanticMode ? 3 : 2)) {
			if (this.searchTimeout) {
				clearTimeout(this.searchTimeout);
			}
			this.searchTimeout = setTimeout(() => {
				if (this.semanticMode) {
					void this.semanticSearch(this.query);
				} else {
					void this.search(this.query);
				}
			}, 50);
		}
	}

	setQuery(value: string) {
		this.query = value;
		this.selectedIndex = 0;

		// clear previous timeout
		if (this.searchTimeout) {
			clearTimeout(this.searchTimeout);
		}

		// validate length
		if (value.length > MAX_QUERY_LENGTH) {
			this.error = `query too long (max ${MAX_QUERY_LENGTH} characters)`;
			this.results = [];
			this.semanticResults = [];
			this.counts = { tracks: 0, artists: 0, albums: 0, tags: 0, playlists: 0 };
			return;
		}

		this.error = null;

		if (this.semanticMode) {
			// semantic search: 400ms debounce (modal cold start), min 3 chars
			if (value.length >= 3) {
				this.searchTimeout = setTimeout(() => {
					void this.semanticSearch(value);
				}, 400);
			} else {
				this.semanticResults = [];
			}
		} else {
			// regular search: 150ms debounce, min 2 chars
			if (value.length >= 2) {
				this.searchTimeout = setTimeout(() => {
					void this.search(value);
				}, 150);
			} else {
				this.results = [];
				this.counts = { tracks: 0, artists: 0, albums: 0, tags: 0, playlists: 0 };
			}
		}
	}

	async search(query: string): Promise<void> {
		if (query.length < 2) return;

		this.loading = true;
		this.error = null;

		try {
			const response = await fetch(
				`${API_URL}/search/?q=${encodeURIComponent(query)}&limit=10`
			);

			if (!response.ok) {
				throw new Error(`search failed: ${response.statusText}`);
			}

			const data: SearchResponse = await response.json();
			this.results = data.results;
			this.counts = data.counts;
			this.selectedIndex = 0;
		} catch (e) {
			console.error('search error:', e);
			this.error = e instanceof Error ? e.message : 'search failed';
			this.results = [];
		} finally {
			this.loading = false;
		}
	}

	async semanticSearch(query: string): Promise<void> {
		if (query.length < 3) return;

		this.loading = true;
		this.error = null;

		try {
			const response = await fetch(
				`${API_URL}/search/semantic?q=${encodeURIComponent(query)}&limit=10`
			);

			if (response.status === 503) {
				this.error = 'semantic search is not available yet';
				this.semanticResults = [];
				return;
			}

			if (!response.ok) {
				throw new Error(`semantic search failed: ${response.statusText}`);
			}

			const data: SemanticSearchResponse = await response.json();
			this.semanticResults = data.results;
			this.selectedIndex = 0;
		} catch (e) {
			console.error('semantic search error:', e);
			this.error = e instanceof Error ? e.message : 'semantic search failed';
			this.semanticResults = [];
		} finally {
			this.loading = false;
		}
	}

	get activeResults(): (SearchResult | SemanticSearchResult)[] {
		return this.semanticMode ? this.semanticResults : this.results;
	}

	selectNext() {
		if (this.activeResults.length > 0) {
			this.selectedIndex = (this.selectedIndex + 1) % this.activeResults.length;
		}
	}

	selectPrevious() {
		if (this.activeResults.length > 0) {
			this.selectedIndex = (this.selectedIndex - 1 + this.activeResults.length) % this.activeResults.length;
		}
	}

	getSelectedResult(): SearchResult | SemanticSearchResult | null {
		return this.activeResults[this.selectedIndex] ?? null;
	}

	getResultHref(result: SearchResult | SemanticSearchResult): string {
		switch (result.type) {
			case 'track':
				return `/track/${result.id}`;
			case 'artist':
				return `/u/${result.handle}`;
			case 'album':
				return `/u/${result.artist_handle}/album/${result.slug}`;
			case 'tag':
				return `/tag/${result.name}`;
			case 'playlist':
				return `/playlist/${result.id}`;
		}
	}
}

export const search = new SearchState();
