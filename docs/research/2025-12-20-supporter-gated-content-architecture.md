# research: supporter-gated content architecture

**date**: 2025-12-20
**question**: how do we prevent direct R2 access to paywalled audio content?

## the problem

current architecture:
```
upload → R2 (public bucket) → `https://pub-xxx.r2.dev/audio/{file_id}.mp3`
                                    ↓
                            anyone with URL can access
```

if we add supporter-gating at the API level, users can bypass it:
1. view network requests when a supporter plays a track
2. extract the R2 URL
3. share it directly (or access it themselves without being a supporter)

## solution options

### option 1: private bucket + presigned URLs

**architecture:**
```
upload → R2 (PRIVATE bucket) → not directly accessible
                ↓
        backend generates presigned URL on demand
                ↓
        supporter validated → 1-hour presigned URL returned
        not supporter → 402 "become a supporter"
```

**how it works:**
```python
# backend/storage/r2.py
async def get_presigned_url(self, file_id: str, expires_in: int = 3600) -> str:
    """generate presigned URL for private bucket access."""
    async with self.async_session.client(...) as client:
        return await client.generate_presigned_url(
            'get_object',
            Params={'Bucket': self.private_audio_bucket, 'Key': f'audio/{file_id}.mp3'},
            ExpiresIn=expires_in
        )
```

**pros:**
- strong access control - no way to bypass
- URLs expire automatically
- standard S3 pattern, well-supported

**cons:**
- presigned URLs use S3 API domain (`<account>.r2.cloudflarestorage.com`), not CDN
- no Cloudflare caching (every request goes to origin)
- potentially higher latency and costs
- need separate bucket for gated content

**cost impact:**
- R2 egress is free, but no CDN caching means more origin requests
- Class A operations (PUT, LIST) cost more than Class B (GET)

### option 2: dual bucket (public + private)

**architecture:**
```
public tracks → audio-public bucket → direct CDN URLs
gated tracks  → audio-private bucket → presigned URLs only
```

**upload flow:**
```python
if track.required_support_tier:
    bucket = self.private_audio_bucket
else:
    bucket = self.public_audio_bucket
```

**pros:**
- public content stays fast (CDN cached)
- only gated content needs presigned URLs
- gradual migration possible

**cons:**
- complexity of managing two buckets
- track tier change = file move between buckets
- still no CDN for gated content

### option 3: cloudflare access + workers (enterprise-ish)

**architecture:**
```
all audio → R2 bucket (with custom domain)
                ↓
        Cloudflare Worker validates JWT/supporter status
                ↓
        pass → serve from R2
        fail → 402 response
```

**how it works:**
- custom domain on R2 bucket (e.g., `audio.plyr.fm`)
- Cloudflare Worker intercepts requests
- worker validates supporter token from cookie/header
- if valid, proxies request to R2

**pros:**
- CDN caching works (huge for audio streaming)
- single bucket
- flexible access control

**cons:**
- requires custom domain setup
- worker invocations add latency (~1-5ms)
- more infrastructure to maintain
- Cloudflare Access (proper auth) requires Pro plan

### option 4: short-lived tokens in URL path

**architecture:**
```
backend generates: /audio/{token}/{file_id}
                        ↓
            token = sign({file_id, expires, user_did})
                        ↓
            frontend plays URL normally
                        ↓
            if token invalid/expired → 403
```

**how it works:**
```python
# generate token
token = jwt.encode({
    'file_id': file_id,
    'exp': time.time() + 3600,
    'sub': viewer_did
}, SECRET_KEY)

url = f"https://api.plyr.fm/audio/{token}/{file_id}"

# validate on request
@router.get("/audio/{token}/{file_id}")
async def stream_gated_audio(token: str, file_id: str):
    payload = jwt.decode(token, SECRET_KEY)
    if payload['file_id'] != file_id:
        raise HTTPException(403)
    if payload['exp'] < time.time():
        raise HTTPException(403, "URL expired")

    # proxy to R2 or redirect to presigned URL
    return RedirectResponse(await storage.get_presigned_url(file_id))
```

**pros:**
- works with existing backend
- no new infrastructure
- token validates both file and user

**cons:**
- every request hits backend (no CDN)
- sharing URL shares access (until expiry)
- backend becomes bottleneck for streaming

## recommendation

**for MVP (phase 1-2)**: option 2 (dual bucket)

rationale:
- public content (majority) stays fast
- gated content works correctly, just slightly slower
- simple to implement with existing boto3 code
- no new infrastructure needed

**for scale (phase 3+)**: option 3 (workers)

rationale:
- CDN caching for all content
- better streaming performance
- more flexible access control
- worth the complexity at scale

## implementation plan for dual bucket

### 1. create private bucket

```bash
# create private audio bucket (no public access)
wrangler r2 bucket create audio-private-dev
wrangler r2 bucket create audio-private-staging
wrangler r2 bucket create audio-private-prod
```

### 2. add config

```python
# config.py
r2_private_audio_bucket: str = Field(
    default="",
    validation_alias="R2_PRIVATE_AUDIO_BUCKET",
    description="R2 private bucket for supporter-gated audio",
)
```

### 3. update R2Storage

```python
# storage/r2.py
async def save_gated(self, file: BinaryIO, filename: str, ...) -> str:
    """save to private bucket for gated content."""
    # same as save() but uses private_audio_bucket

async def get_presigned_url(self, file_id: str, expires_in: int = 3600) -> str:
    """generate presigned URL for private content."""
    key = f"audio/{file_id}.mp3"  # need extension from DB
    return self.client.generate_presigned_url(
        'get_object',
        Params={'Bucket': self.private_audio_bucket, 'Key': key},
        ExpiresIn=expires_in
    )
```

### 4. update audio endpoint

```python
# api/audio.py
@router.get("/{file_id}")
async def stream_audio(file_id: str, session: Session | None = Depends(optional_auth)):
    track = await get_track_by_file_id(file_id)

    if track.required_support_tier:
        # gated content - validate supporter status
        if not session:
            raise HTTPException(401, "login required")

        is_supporter = await validate_supporter(
            supporter=session.did,
            subject=track.artist_did
        )

        if not is_supporter:
            raise HTTPException(402, "supporter access required")

        # return presigned URL for private bucket
        url = await storage.get_presigned_url(file_id)
        return RedirectResponse(url)

    # public content - use CDN URL
    return RedirectResponse(track.r2_url)
```

### 5. upload flow change

```python
# api/tracks.py (in upload handler)
if required_support_tier:
    file_id = await storage.save_gated(file, filename)
    # no public URL - will be generated on demand
    r2_url = None
else:
    file_id = await storage.save(file, filename)
    r2_url = f"{settings.storage.r2_public_bucket_url}/audio/{file_id}{ext}"
```

## open questions

1. **what about tier changes?**
   - if artist makes public track → gated: need to move file to private bucket
   - if gated → public: move to public bucket
   - or: store everything in private, just serve presigned URLs for everything (simpler but slower)

2. **presigned URL expiry for long audio?**
   - 1 hour default should be plenty for any track
   - frontend can request new URL if needed mid-playback

3. **should we cache presigned URLs?**
   - could cache for 30 minutes to reduce generation overhead
   - but then revocation is delayed

4. **offline mode interaction?**
   - supporters could download gated tracks for offline
   - presigned URL works for initial download
   - cached locally, no expiry concern

## references

- [Cloudflare R2 presigned URLs docs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 + Access protection](https://developers.cloudflare.com/r2/tutorials/cloudflare-access/)
- boto3 `generate_presigned_url()` - already available in our client
