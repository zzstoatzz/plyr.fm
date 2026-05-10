# upload crash analysis

## problem report

user (doom.bsky.social) attempted to upload an hour-long mix multiple times over several hours from both laptop and iPhone. the upload:
- loaded the file successfully from phone
- timed out when hitting "publish"
- showed no progress
- reset the form fields automatically

### original user interaction transcript

```
nate: Hey man tryna upload a mix to your site and it's crashing. My friend Stella said you could maybe help.

nate: damn ok, one min lemme look

[investigation begins]

nate: hmm can you tell me roughly when you tried?
nate: and file format and rough duration?
nate: not seeing the spans just yet

user: A few times over the last couple hours, from phone and laptop. It's an hour mix.
      It loaded the file from the phone but when I hit publish it just timed out and
      never showed any progress then refreshed the fields itself
```

## logfire investigation

### what we found
- **laptop upload (04:25:34)**: successful POST /tracks/ with 200 status, took 4.5s, completed background processing
- **iPhone attempts (around 04:20)**: NO POST /tracks/ requests logged at all
- user was authenticated and viewing their profile page on iPhone
- multiple successful GET /artists/by-handle/doom.bsky.social from iPhone user agent

### what this means
the frontend never sent the POST request from mobile. the failure occurred **before** the HTTP request was made, ruling out:
- backend timeouts
- SSE connection issues
- server-side errors
- network connection problems (other requests worked)

## code analysis

### current implementation (frontend/src/lib/uploader.svelte.ts:49-64)

```typescript
fetch(`${API_URL}/tracks/`, {
    method: 'POST',
    body: formData,
    headers: {
        'Authorization': `Bearer ${sessionId}`
    }
})
```

the upload flow:
1. user selects file in portal/+page.svelte
2. on submit, `handleUpload()` captures file reference (line 192-224)
3. calls `uploader.upload()` which:
   - creates FormData
   - **appends file directly** - FormData handles the file streaming internally
   - sends POST request
4. backend reads via UploadFile which streams from request body

### what we initially suspected but is NOT the issue

we thought the problem was `await file.read()` reading entire file into memory, but **the code doesn't do this**. FormData in browsers handles File objects efficiently without loading into memory.

### actual problem areas

1. **no error handling around fetch** (uploader.svelte.ts:50-64)
   - if fetch() throws before getting response (network error, memory issue, timeout), only generic catch at line 126 handles it
   - on mobile, large file uploads can fail silently due to:
     - iOS memory pressure causing tab reload
     - mobile browser resource limits
     - network state changes during upload
     - background tab throttling

2. **no upload progress indication**
   - fetch() with FormData provides no progress events for upload phase
   - user sees "uploading track..." toast but no percentage
   - for 100MB file on mobile network, could take 30s-2min with no feedback

3. **no explicit file size validation**
   - portal/+page.svelte shows warning at line 31-34 for files >10MB
   - but no hard limit or user confirmation for very large files (>50MB)
   - mobile browsers may silently fail on large uploads

4. **form reset timing** (portal/+page.svelte:203-218)
   - form clears **immediately** before upload starts
   - if upload fails before POST is sent, user loses all form data
   - this matches reported behavior: "timed out... then refreshed the fields itself"

## root cause hypothesis

on iPhone, when uploading 100MB+ file:
1. user hits submit
2. form clears immediately (line 203-218)
3. `uploader.upload()` starts creating FormData
4. either:
   - iOS kills the tab due to memory pressure during FormData creation
   - fetch() call fails silently before sending request
   - network timeout occurs during initial upload phase
5. error caught by generic handler (line 126-129)
6. toast shows "network error" but form already cleared
7. user sees: form reset + error message (matches "timed out and refreshed the fields")

## proposed solution

### phase 1: immediate fixes (required for mobile uploads to work)

1. **add XMLHttpRequest with progress tracking**
   - replace fetch() with XHR for upload progress events
   - show real-time upload percentage in toast
   - detect stalls (no progress for >30s) and show appropriate error

2. **delay form reset until upload starts successfully**
   - only clear form after receiving upload_id from server
   - on error before upload_id, restore form state
   - prevents data loss on mobile failures

3. **add explicit file size warnings**
   - warn at 50MB: "large file, may take several minutes on mobile"
   - warn at 100MB: "very large file, wifi recommended"
   - consider soft limit at 200MB with confirmation

4. **improve error messages**
   - detect if on mobile device
   - provide mobile-specific guidance: "try wifi", "keep screen on", etc.
   - log more details about failure point

### phase 2: proper streaming upload (ideal long-term solution)

1. **chunked upload with resumability**
   - split large files into 5-10MB chunks
   - upload chunks sequentially with progress tracking
   - store chunk state to allow resume after interruption
   - backend endpoint: POST /tracks/chunks/{upload_id}

2. **background upload service**
   - use service worker to handle uploads
   - survives page reloads and tab switches
   - periodic sync for failed uploads

3. **compress before upload (optional)**
   - for wav/aiff files, offer client-side transcoding to mp3
   - reduces upload time significantly
   - requires web audio API + worker thread

### phase 3: mobile-specific optimizations

1. **detect and warn about problematic conditions**
   - low battery (navigator.getBattery)
   - cellular vs wifi (navigator.connection.effectiveType)
   - background tab detection (document.hidden)

2. **keep-alive mechanisms**
   - play silent audio to prevent iOS from suspending tab
   - request wake lock during upload (navigator.wakeLock)
   - show persistent notification during upload

## implementation priority

**critical (do now):**
- add XHR with progress tracking (fixes "no feedback" issue)
- delay form reset until upload_id received (fixes "lost data" issue)
- improve error handling and messages (helps debugging)

**important (do soon):**
- add file size warnings and limits (sets expectations)
- mobile device detection and specific guidance (improves UX)

**nice to have (future):**
- chunked upload with resumability (proper fix for large files)
- service worker background upload (best mobile experience)

## testing plan

1. test 100MB+ file upload on:
   - iPhone Safari (primary issue)
   - Android Chrome
   - desktop browsers (regression test)

2. test failure scenarios:
   - switch tabs during upload
   - lock phone during upload
   - poor network conditions (throttle to 3G)
   - intentional network interruption

3. test progress indicators:
   - verify percentage updates smoothly
   - verify stall detection works
   - verify error messages are helpful

## acceptance criteria

upload from mobile considered "fixed" when:
- 100MB file uploads successfully from iPhone
- user sees progress percentage throughout upload
- on failure, user gets helpful error message
- on failure, form data is not lost (or user is warned before retry)
- upload survives brief tab switches on mobile
