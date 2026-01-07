# data loading

## overview

plyr.fm uses SvelteKit's server-side and client-side load functions for optimal performance and SEO.

## patterns

### server-side loading (`+page.server.ts`)

used for:
- SEO-critical pages (artist profiles, album pages)
- data needed before page renders
- public data that doesn't require client auth

```typescript
// frontend/src/routes/u/[handle]/+page.server.ts
export const load: PageServerLoad = async ({ params, fetch }) => {
	const artistResponse = await fetch(`${API_URL}/artists/by-handle/${params.handle}`);
	const artist = await artistResponse.json();

	// parallel fetches for related data
	const [tracks, albums] = await Promise.all([
		fetch(`${API_URL}/tracks/?artist_did=${artist.did}`).then(r => r.json()),
		fetch(`${API_URL}/albums/${params.handle}`).then(r => r.json())
	]);

	return { artist, tracks, albums };
};
```

**benefits**:
- data loads in parallel on server before page renders
- eliminates client-side waterfall (sequential fetches)
- proper HTTP status codes (404, 500) instead of loading states
- meta tags populated with real data for link previews
- faster perceived performance

**example improvement**:
- before: artist page loaded in ~1.66s (sequential client fetches)
- after: instant render with server-loaded data

### client-side loading (`+page.ts`)

used for:
- auth-dependent data (liked tracks, user preferences)
- data that needs client context (local caches, media state)
- progressive enhancement

```typescript
// frontend/src/routes/liked/+page.ts
export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch(`${API_URL}/tracks/liked`, {
		credentials: 'include'
	});

	if (!response.ok) return { tracks: [] };

	return { tracks: await response.json() };
};
```

**benefits**:
- access to browser APIs (window, local caches)
- runs on client, can use HttpOnly cookie auth
- still loads before component mounts (faster than `onMount`)

### layout loading (`+layout.ts`)

used for:
- auth state (shared across all pages)
- global data needed everywhere

```typescript
// frontend/src/routes/+layout.ts
export async function load({ fetch }: LoadEvent) {
	const response = await fetch(`${API_URL}/auth/me`, {
		credentials: 'include'
	});

	if (response.ok) {
		return { user: await response.json(), isAuthenticated: true };
	}

	return { user: null, isAuthenticated: false };
}
```

**benefits**:
- loads once for entire app
- shared data available to all child routes
- eliminates duplicate auth checks on every page

## anti-patterns

### ❌ using `onMount` for initial data

```typescript
// BAD - causes flash of loading, SEO issues
let data = $state(null);

onMount(async () => {
	const response = await fetch('/api/data');
	data = await response.json();
});
```

**problems**:
- page renders empty, then populates (flash of loading)
- data not available for SSR/link previews
- slower perceived performance
- sequential waterfalls when multiple fetches needed

### ✅ use load functions instead

```typescript
// GOOD - data ready before render
export const load: PageLoad = async ({ fetch }) => {
	return { data: await fetch('/api/data').then(r => r.json()) };
};
```

## when to use what

| use case | pattern | file |
|----------|---------|------|
| public data, SEO critical | server load | `+page.server.ts` |
| auth-dependent data | client load | `+page.ts` |
| global shared data | layout load | `+layout.ts` |
| real-time updates | state manager | `lib/*.svelte.ts` |
| form submissions | server actions | `+page.server.ts` |
| progressive enhancement | `onMount` | component |

## migration history

### november 2025 - server-side data loading shift

**PR #210**: centralized auth and client-side load functions
- added `+layout.ts` for auth state
- added `+page.ts` to liked tracks page
- centralized auth manager in `lib/auth.svelte.ts`

**PR #227**: artist pages moved to server-side loading
- replaced client `onMount` fetches with `+page.server.ts`
- parallel data loading for artist, tracks, albums
- performance: ~1.66s → instant render

**result**:
- eliminated "flash of loading" across the app
- improved SEO for artist and album pages
- reduced code duplication (-308 lines, +256 lines net change)
- consistent auth patterns everywhere

## performance impact

### before (client-side onMount pattern)
1. page renders with loading state
2. component mounts
3. fetch artist data (250ms)
4. fetch tracks data (1060ms)
5. fetch albums data (346ms)
6. total: ~1.66s before meaningful render

### after (server-side load pattern)
1. server fetches all data in parallel
2. page renders with complete data
3. total: instant render

### metrics
- artist page load time: 1.66s → <200ms
- eliminated sequential waterfall
- reduced client-side API calls
- better lighthouse scores

## browser caching considerations

SvelteKit's load functions benefit from:
- browser HTTP cache (respects Cache-Control headers)
- SvelteKit's internal navigation cache
- preloading on link hover

but watch for:
- stale data after mutations (invalidate with `invalidate()`)
- localStorage caching (tracks cache uses this intentionally)
- session token expiry (refresh in layout load)

## current issue (#225)

there's an ongoing investigation into unwanted auto-play behavior after page refresh:
- symptom: page refresh sometimes starts playing immediately
- suspected cause: client-side caching of playback state
- `autoplay_next` preference set to false but not respected
- may be related to queue state restoration
- needs investigation into what client-side state is persisting

this highlights the importance of understanding the boundary between:
- server-loaded data (authoritative, fresh on each load)
- client state (persists in localStorage, may be stale)
- when to use which pattern
