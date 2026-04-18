// global search state using Svelte 5 runes
import { API_URL } from '$lib/config';

export type SearchResultType = 'track' | 'artist' | 'album' | 'tag' | 'playlist';
export type SearchMode = 'keyword' | 'semantic';

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
	available: boolean;
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
const EMPTY_COUNTS: SearchResponse['counts'] = {
	tracks: 0,
	artists: 0,
	albums: 0,
	tags: 0,
	playlists: 0
};

class SearchState {
	isOpen = $state(false);
	query = $state('');
	results = $state<SearchResult[]>([]);
	counts = $state<SearchResponse['counts']>({ ...EMPTY_COUNTS });
	loading = $state(false);
	error = $state<string | null>(null);
	selectedIndex = $state(0);

	// semantic search state
	semanticEnabled = $state(false);
	semanticLoading = $state(false);
	semanticAvailable = $state(true);
	semanticResults = $state<SemanticSearchResult[]>([]);

	// mode toggle — only exposed to users with the vibe-search flag
	mode = $state<SearchMode>('keyword');

	// reference to input element for direct focus (mobile keyboard workaround)
	inputRef: HTMLInputElement | null = null;

	// separate debounce timers
	private keywordTimeout: ReturnType<typeof setTimeout> | null = null;
	private semanticTimeout: ReturnType<typeof setTimeout> | null = null;

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
		this.counts = { ...EMPTY_COUNTS };
		this.error = null;
		this.selectedIndex = 0;
	}

	close() {
		this.isOpen = false;
		this.query = '';
		this.results = [];
		this.semanticResults = [];
		this.error = null;
		this.mode = 'keyword';
		if (this.keywordTimeout) {
			clearTimeout(this.keywordTimeout);
			this.keywordTimeout = null;
		}
		if (this.semanticTimeout) {
			clearTimeout(this.semanticTimeout);
			this.semanticTimeout = null;
		}
	}

	toggle() {
		if (this.isOpen) {
			this.close();
		} else {
			this.open();
		}
	}

	setQuery(value: string) {
		this.query = value;
		this.selectedIndex = 0;

		// always clear both timers — we never want a stale fetch racing the active mode
		if (this.keywordTimeout) {
			clearTimeout(this.keywordTimeout);
			this.keywordTimeout = null;
		}
		if (this.semanticTimeout) {
			clearTimeout(this.semanticTimeout);
			this.semanticTimeout = null;
		}

		// validate length
		if (value.length > MAX_QUERY_LENGTH) {
			this.error = `query too long (max ${MAX_QUERY_LENGTH} characters)`;
			this.results = [];
			this.semanticResults = [];
			this.counts = { ...EMPTY_COUNTS };
			return;
		}

		this.error = null;

		if (this.mode === 'keyword') {
			// fire keyword search only; clear any semantic state
			this.semanticResults = [];
			this.semanticLoading = false;
			if (value.length >= 2) {
				this.loading = true;
				this.keywordTimeout = setTimeout(() => {
					void this.search(value);
				}, 150);
			} else {
				this.loading = false;
				this.results = [];
				this.counts = { ...EMPTY_COUNTS };
			}
		} else {
			// fire semantic search only; clear any keyword state
			this.results = [];
			this.counts = { ...EMPTY_COUNTS };
			this.loading = false;
			if (value.length >= 3) {
				this.semanticLoading = true;
				this.semanticTimeout = setTimeout(() => {
					void this.searchSemantic(value);
				}, 500);
			} else {
				this.semanticLoading = false;
				this.semanticResults = [];
			}
		}
	}

	setMode(next: SearchMode) {
		if (next === this.mode) return;
		this.mode = next;
		this.results = [];
		this.semanticResults = [];
		this.counts = { ...EMPTY_COUNTS };
		this.selectedIndex = 0;
		if (this.query.length >= 2) {
			this.setQuery(this.query);
		}
	}

	async search(query: string): Promise<void> {
		if (query.length < 2) return;

		const modeAtStart = this.mode;
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

			// stale query or stale mode guard
			if (this.query !== query || this.mode !== modeAtStart) return;

			this.results = data.results;
			this.counts = data.counts;
			this.selectedIndex = 0;
		} catch (e) {
			if (this.query !== query || this.mode !== modeAtStart) return;
			console.error('search error:', e);
			this.error = e instanceof Error ? e.message : 'search failed';
			this.results = [];
		} finally {
			if (this.mode === modeAtStart && this.query === query) {
				this.loading = false;
			}
		}
	}

	async searchSemantic(query: string): Promise<void> {
		if (query.length < 3) return;

		const modeAtStart = this.mode;
		this.semanticLoading = true;

		try {
			const response = await fetch(
				`${API_URL}/search/semantic?q=${encodeURIComponent(query)}&limit=10`
			);

			if (!response.ok) {
				// non-ok but not a structured response — silently degrade
				if (this.query === query && this.mode === modeAtStart) {
					this.semanticResults = [];
					this.semanticAvailable = false;
				}
				return;
			}

			const data: SemanticSearchResponse = await response.json();

			// stale query or stale mode guard
			if (this.query !== query || this.mode !== modeAtStart) return;

			this.semanticAvailable = data.available;
			this.semanticResults = data.available ? data.results : [];
			this.selectedIndex = 0;
		} catch (e) {
			if (this.query !== query || this.mode !== modeAtStart) return;
			console.error('semantic search error:', e);
			this.semanticResults = [];
		} finally {
			if (this.mode === modeAtStart && this.query === query) {
				this.semanticLoading = false;
			}
		}
	}

	get activeResults(): (SearchResult | SemanticSearchResult)[] {
		return this.mode === 'keyword' ? this.results : this.semanticResults;
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
