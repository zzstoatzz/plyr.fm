# HTTP/1.1 Connection Pooling Limitation

## Problem Statement

When uploading a large file (8-9 seconds) and attempting to navigate to the homepage during the upload, the homepage hangs until the upload completes. The desired behavior is for uploads to continue in the background while allowing immediate navigation.

## What We Tried

1. **Toast notification system** - Successfully implemented global toast notifications using Svelte 5 runes
2. **Fire-and-forget uploads** - Changed from `await` to `.then()` pattern
3. **setTimeout wrapper** - Attempted to defer upload execution
4. **Component lifecycle management** - Added `onDestroy` and `isMounted` tracking
5. **AbortController** - Tried canceling uploads on navigation
6. **Global upload manager** - Created `uploader.svelte.ts` similar to `player.svelte.ts`

## Why They All Failed

The root cause is **browser HTTP/1.1 connection pooling limits at the TCP level**:

- Chrome limits **6 concurrent HTTP/1.1 connections per hostname**
- This is a browser-level TCP limitation, not a JavaScript execution issue
- When a long-running upload occupies 1 connection, only 5 remain available
- Homepage navigation triggers 2 fetch requests (`/auth/me` + `/tracks/`)
- These requests get **queued** waiting for an available connection
- No JavaScript pattern (async/await, promises, global state) can bypass TCP-level connection limits

## Proof

From our research:
> "Chrome has a limit of 6 connections per host name, and a max of 10 connections total across all domains."
>
> "When you initiate 100 HTTP/1.1 requests to a domain, only 6 requests will be processed concurrently at any given moment. The remaining requests will be queued."

Our network tab showed the `tracks/` request had status `(canceled)` after navigation, but the homepage still waited - confirming the requests were queued at the browser's connection pool level, not the JavaScript level.

## Actual Solutions

### 1. HTTP/2 (Recommended)

**Pros:**
- Completely solves the problem via connection multiplexing
- Allows unlimited concurrent requests over a single TCP connection
- Production (Fly.io) likely already uses HTTP/2 over HTTPS
- Industry standard solution

**Cons:**
- Requires HTTPS (complicated for local development)
- Need to configure uvicorn/Hypercorn for HTTP/2

**Implementation:**
```python
# Use Hypercorn instead of uvicorn
# hypercorn supports HTTP/2 natively with h2 library
```

### 2. Accept the Limitation

**Pros:**
- No additional work required
- Toast system still provides value for upload feedback
- Production may not exhibit this issue if using HTTP/2

**Cons:**
- Poor UX for large file uploads in local development
- Users cannot navigate during uploads

### 3. Web Workers

**Pros:**
- Uploads run in separate thread with separate connection pool
- Truly non-blocking at JavaScript level

**Cons:**
- Complex implementation
- Still subject to browser connection limits
- May not fully solve the problem

## Recommendation

1. **Keep the toast notification system** - it's valuable regardless
2. **Keep the global upload manager** - clean architecture, ready for HTTP/2
3. **Accept the local dev limitation** - it's likely not present in production
4. **Consider HTTP/2 if issue persists in production**

## Files Modified

- `frontend/src/lib/toast.svelte.ts` - Global toast state (keep)
- `frontend/src/lib/components/Toast.svelte` - Toast UI component (keep)
- `frontend/src/lib/uploader.svelte.ts` - Global upload manager (keep)
- `frontend/src/routes/+layout.svelte` - Toast integration (keep)
- `frontend/src/routes/+page.svelte` - Loading state improvements (keep)
- `frontend/src/routes/portal/+page.svelte` - Simplified to use global uploader (keep)

## Lesson Learned

Browser-level TCP connection pooling cannot be worked around with JavaScript patterns. The solution requires protocol-level changes (HTTP/2) or accepting the limitation.
