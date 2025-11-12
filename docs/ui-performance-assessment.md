# ui performance & loading state assessment

## recent navigation patterns (last 2 hours)

based on logfire trace data from 08:38 - 08:46:

### user flow observed:
1. **home page** (`/`) - main track listing
2. **liked tracks** (`/tracks/liked`) - user's liked content
3. **profile/dashboard** (`/portal`) - artist management
4. **artist profiles** (`/u/piss.beauty`, `/u/zzstoatzz.io`) - public artist pages

### performance metrics

#### artist profile page (`/u/{handle}`)
- **artist lookup**: ~12-14ms (excellent)
- **tracks fetch**: ~100-115ms (good)
- **analytics fetch**: ~20-35ms (excellent)
- **total page load**: ~160-180ms

**key insight**: analytics loading is **NOT blocking** the page render! ✅
- analytics loads in background (line 162 of `u/[handle]/+page.svelte`)
- page shows immediately with skeleton states
- minimum 300ms display time prevents flicker (lines 133-155)

#### liked tracks page (`/tracks/liked`)
- **before recent fix** (pre-08:38): ~700-1000ms
- **after recent fix** (post-08:41): **~35-40ms** (25x improvement! 🚀)
- **caused by**: eliminating N+1 R2 API calls for image URLs

#### main track listing (`/`)
- **first load**: ~750-780ms (expected - lots of tracks)
- **with cache**: instant (uses localStorage cache)
- **auth check**: ~15-20ms (non-blocking)

## current loading states audit

### 1. **artist profile analytics** (excellent ✅)
**location**: `frontend/src/routes/u/[handle]/+page.svelte:238-277`

**implementation**:
```typescript
// loads in background without blocking
loadAnalytics(); // line 162

// skeleton states with fade transitions
{#if analyticsLoading}
  <div class="stat-card skeleton" transition:fade={{ duration: 200 }}>
    <div class="skeleton-bar large"></div>
    <div class="skeleton-bar small"></div>
  </div>
{:else if analytics}
  <div class="stat-card" transition:fade={{ duration: 200 }}>
    // ... actual content
  </div>
{/if}
```

**strengths**:
- non-blocking background load
- smooth fade transitions (200ms)
- skeleton bars match exact dimensions of real content
- prevents layout shift with `min-height: 120px`
- respects `prefers-reduced-motion`

### 2. **home page track listing** (good ✅)
**location**: `frontend/src/routes/+page.svelte:78-82`

**implementation**:
```typescript
let tracks = $derived(tracksCache.tracks);
let loadingTracks = $derived(tracksCache.loading);
let showLoading = $derived(loadingTracks && !hasTracks);

{#if showLoading}
  <p class="loading-text">loading tracks...</p>
{:else if !hasTracks}
  <p class="empty">no tracks yet</p>
{:else}
  // ... track list
{/if}
```

**strengths**:
- uses cached data (localStorage)
- only shows loading if no cached data available
- instant for returning users

**areas for improvement**:
- could use skeleton items instead of plain text
- no transition animations

### 3. **liked tracks page** (good ✅)
**location**: `frontend/src/routes/liked/+page.svelte:107-139`

**implementation**:
```typescript
{#if loading}
  <div class="loading-container">
    <LoadingSpinner />
  </div>
{:else if error}
  // ... error state
{:else if tracks.length === 0}
  // ... empty state with icon
{:else}
  // ... track list
{/if}
```

**strengths**:
- centered spinner component
- nice empty state with icon and helpful message
- differentiated message for unauthenticated users

**areas for improvement**:
- could show skeleton track items during load
- no transition between states

### 4. **track detail page** (minimal loading ✅)
**location**: `frontend/src/routes/track/[id]/+page.svelte`

**implementation**:
- server-side data loading (SSR)
- only auth check happens client-side (non-blocking)
- immediate content display

**strengths**:
- fast server-side rendering
- no loading state needed
- auth check doesn't block UI

### 5. **loading components**

#### `LoadingSpinner.svelte`
- size variants: sm (16px), md (24px), lg (32px)
- customizable color
- simple rotating circle animation
- accessible (uses SVG)

#### `LoadingOverlay.svelte`
- full-screen overlay with backdrop blur
- centered spinner + message
- high z-index (9999)
- **usage**: not currently used in main flows!

## design language consistency

### current patterns:

1. **skeleton loaders** (artist analytics only)
   - shimmer animation
   - exact dimension matching
   - respects reduced motion

2. **text loading states** (home page)
   - simple "loading tracks..."
   - no animation

3. **spinner loading** (liked tracks)
   - centered `LoadingSpinner` component
   - indeterminate progress

4. **empty states** (liked tracks)
   - icon + heading + description
   - context-aware messaging

### inconsistencies identified:

- ❌ home page uses plain text, liked tracks uses spinner
- ❌ analytics uses skeleton, other pages don't
- ❌ no consistent transition animations between states
- ❌ `LoadingOverlay` exists but isn't used

## transition smoothness

### current transitions:

| location | transition | duration | notes |
|----------|-----------|----------|-------|
| artist analytics | fade | 200ms | smooth, good |
| track items | hover transform | 150ms ease-in-out | snappy, good |
| track containers | all | 150ms ease-in-out | consistent |
| page changes | none | - | could be smoother |

### svelte features in use:

- ✅ svelte 5 runes (`$state`, `$derived`, `$effect`)
- ✅ `transition:fade` on analytics
- ❌ no `fly` or `slide` transitions
- ❌ no page transition animations
- ❌ not using `animate:` directive for list reordering

## recommendations

### immediate wins (high impact, low effort):

1. **standardize on skeleton loaders**
   - create `TrackItemSkeleton.svelte` component
   - use on home page and liked tracks during initial load
   - reuse shimmer animation from artist analytics

2. **add consistent fade transitions**
   - wrap all conditional content in `transition:fade={{ duration: 150 }}`
   - creates smooth state changes throughout app

3. **implement page transition wrapper**
   ```svelte
   <!-- in +layout.svelte -->
   {#key $page.url.pathname}
     <div transition:fade={{ duration: 150 }}>
       <slot />
     </div>
   {/key}
   ```

4. **optimize auth checks**
   - already non-blocking ✅
   - consider extracting to shared store to reduce duplicate fetches

### medium effort improvements:

1. **create unified loading state system**
   ```typescript
   // lib/loading.svelte.ts
   type LoadingState = 'idle' | 'loading' | 'success' | 'error';

   class LoadingManager {
     state = $state<LoadingState>('idle');
     // ... with transitions
   }
   ```

2. **add optimistic updates**
   - like/unlike actions feel instant
   - background sync
   - rollback on failure

3. **implement view transitions api**
   - native browser transitions between pages
   - requires careful opt-in

### performance optimizations:

1. **parallel data fetching** ✅ already doing this!
   - artist profile loads artist + tracks simultaneously
   - analytics loads in background

2. **prefetch on hover**
   - add `data-sveltekit-preload-data="hover"` to artist/track links
   - preloads data on link hover

3. **consider route-level caching**
   - extend tracks cache pattern to artist profiles
   - cache TTL based on content type

## current state: actually pretty good!

### what's working well:
- ✅ analytics doesn't block page render
- ✅ 25x performance improvement on liked tracks
- ✅ caching strategy for main track list
- ✅ non-blocking auth checks
- ✅ parallel data fetching
- ✅ reduced motion support
- ✅ layout shift prevention

### what needs attention:
- 🟡 inconsistent loading state patterns
- 🟡 lack of transition animations between states
- 🟡 could be more optimistic with interactions
- 🟡 unused `LoadingOverlay` component

### overall assessment:
**performance**: A- (excellent after recent fixes)
**consistency**: B (some patterns inconsistent)
**smoothness**: B+ (good hover states, missing page transitions)
**ux**: A- (fast, responsive, good empty states)

## next steps

recommend tackling in this order:

1. create `TrackItemSkeleton.svelte` (1 hour)
2. add fade transitions to page-level content blocks (30 min)
3. add page transition wrapper in `+layout.svelte` (15 min)
4. audit and remove/use `LoadingOverlay` component (10 min)
5. consider view transitions api for page changes (2-3 hours)

total effort: ~4-5 hours for significant consistency and smoothness improvements
