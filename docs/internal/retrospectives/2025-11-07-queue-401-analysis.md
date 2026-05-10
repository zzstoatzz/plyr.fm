# queue 401 errors analysis

## problem

console shows 401 errors when not logged in:
```
:8001/queue/:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)
queue.svelte.ts:186 failed to fetch queue: Error: failed to fetch queue: Unauthorized
:8001/auth/me:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)
:8001/queue/:1  Failed to load resource: the server responded with a status of 401 (Unauthorized)
queue.svelte.ts:369 failed to push queue: Error: failed to push queue: Unauthorized
```

## root cause

**queue.svelte.ts** (`line 576-578`):
```typescript
if (browser) {
  void queue.initialize();
}
```

this runs **immediately** when the module loads, before checking if user is logged in.

**initialize()** (`line 73-113`):
- sets up broadcast channel
- calls `await this.fetchQueue()` at line 109

**fetchQueue()** (`line 139-190`):
- checks for `sessionId` in localStorage (line 153)
- conditionally adds `Authorization` header (line 156-158)
- BUT: always makes the fetch request (line 164)
- backend endpoint **requires auth** (line 34 in `backend/api/queue.py`)

**backend requirement** (`backend/api/queue.py:34`):
```python
session: Session = Depends(require_auth)
```

## why it happens

1. page loads
2. queue module executes, calls `queue.initialize()`
3. `initialize()` calls `fetchQueue()`
4. user not logged in → no `sessionId` in localStorage
5. fetch still happens, just without auth header
6. backend returns 401
7. error logged to console

same issue with `pushQueue()`:
- called from `schedulePush()` → called from any queue mutation
- always tries to sync, even when not authenticated

## solution

**don't initialize queue for unauthenticated users**

options:

### option 1: skip initialization when not logged in

```typescript
// queue.svelte.ts
async initialize() {
  if (!browser || this.initialized) return;

  const sessionId = localStorage.getItem('session_id');
  if (!sessionId) {
    // no session, skip initialization
    this.initialized = true;
    return;
  }

  // ... rest of initialization
}
```

**pros**: simple, minimal changes
**cons**: queue won't work at all when not logged in (but that's probably fine - who needs a queue when not logged in?)

### option 2: gracefully handle 401 in fetch/push

```typescript
async fetchQueue(force = false) {
  // ... existing code ...

  if (!response.ok) {
    if (response.status === 401) {
      // not authenticated, skip silently
      return;
    }
    throw new Error(`failed to fetch queue: ${response.statusText}`);
  }

  // ... rest
}
```

**pros**: no errors logged for expected 401s
**cons**: still makes unnecessary network requests

### option 3: check auth before any server operation

```typescript
private isAuthenticated(): boolean {
  return !!localStorage.getItem('session_id');
}

async fetchQueue(force = false) {
  if (!browser) return;
  if (!this.isAuthenticated()) return; // skip if not authenticated

  // ... rest
}

async pushQueue(): Promise<boolean> {
  if (!browser) return false;
  if (!this.isAuthenticated()) return false; // skip if not authenticated

  // ... rest
}
```

**pros**: no unnecessary requests, no errors
**cons**: need to add check to every server operation

## recommended fix

**combination of option 1 + option 3**:

1. **skip initialization when not authenticated** (option 1)
   - queue operations won't be set up for unauthenticated users
   - prevents initial fetch error

2. **guard fetch/push operations** (option 3)
   - even if queue somehow gets used while logged out
   - prevents any 401 errors from reaching console

3. **reinitialize on login** (new)
   - when user logs in, initialize the queue
   - requires adding an init call after successful auth

## implementation (completed)

### queue.svelte.ts

```typescript
async initialize() {
  if (!browser || this.initialized) return;
  this.initialized = true;

  // ... setup tabId, autoAdvance, broadcast channel ...

  // only fetch from server if authenticated
  if (this.isAuthenticated()) {
    await this.fetchQueue();
  }

  // ... event listeners (visibilitychange, beforeunload) ...
}

private isAuthenticated(): boolean {
  if (!browser) return false;
  return !!localStorage.getItem('session_id');
}

async fetchQueue(force = false) {
  if (!browser) return;
  if (!this.isAuthenticated()) return; // skip if not authenticated

  // ... rest of existing code (fetch from server, apply snapshot)
}

async pushQueue(): Promise<boolean> {
  if (!browser) return false;
  if (!this.isAuthenticated()) return false; // skip if not authenticated

  // ... rest of existing code (send to server)
}
```

**key insight**: these guards ONLY prevent server communication, not local queue operations. all queue methods (addTracks, setQueue, playNow, next, previous, toggleShuffle, moveTrack, removeTrack, etc.) work independently and update local state. they call `schedulePush()` which eventually tries `pushQueue()`, but if that returns false silently, the local state still works perfectly.

### auth callback (after login)

wherever user logs in successfully, fetch queue state:

```typescript
// after successful login
localStorage.setItem('session_id', sessionId);
// queue is already initialized, just fetch server state
await queue.fetchQueue(true); // force fetch to get persisted state
```

## benefits

1. **no 401 errors** when not logged in
2. **no unnecessary requests** to authenticated endpoints
3. **queue works for everyone** - local state works without auth
4. **server sync when authenticated** - persisted state synced for logged-in users
5. **clean console** - no spurious errors
6. **proper separation** - local functionality always available, persistence only when authenticated

## edge cases

**what if user logs out?**
- queue keeps running in current implementation
- should probably clear queue and stop syncing
- add `queue.destroy()` method?

**what if session expires?**
- 401 on next fetch/push
- could detect and handle gracefully (clear queue, show login prompt?)

**what about multi-tab?**
- broadcast channel still works if all tabs are authenticated
- if one tab logs out, others continue normally (each has own sessionId check)
