---
title: "sensitive content moderation"
---

## overview

plyr.fm allows creators to upload audio and cover art and use their Bluesky
avatars. some of this content may be inappropriate for general audiences.
sensitive images are blurred by default, and adult-labeled audio is omitted and
cannot be streamed until an authenticated listener opts in.

this follows our core moderation philosophy: **information, not enforcement**. we flag content and let users decide what they want to see.

## current implementation

### database schema

```sql
-- tracks flagged images
CREATE TABLE sensitive_images (
    id SERIAL PRIMARY KEY,
    image_id VARCHAR,          -- R2 image ID (for uploaded images)
    url TEXT,                  -- full URL (for external images like Bluesky avatars)
    reason VARCHAR,            -- why flagged: 'nudity', 'violence', etc.
    flagged_at TIMESTAMPTZ,
    flagged_by VARCHAR         -- admin identifier
);

-- user preference
ALTER TABLE user_preferences ADD COLUMN show_sensitive_artwork BOOLEAN DEFAULT false;
ALTER TABLE user_preferences ADD COLUMN show_sensitive_audio BOOLEAN DEFAULT false;
```

images can be flagged by either:
- `image_id` - for images uploaded to R2 (track artwork, album covers)
- `url` - for external images (Bluesky avatars synced from PDS)

### frontend architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        page load                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ +layout.server│    │ +layout.ts    │    │ +layout.svelte│
│ fetch flagged │    │ pass through  │    │ init client   │
│ images (SSR)  │    │ to pages      │    │ moderation    │
└───────────────┘    └───────────────┘    └───────────────┘
        │                                         │
        ▼                                         ▼
┌───────────────┐                        ┌───────────────┐
│ meta tags use │                        │ SensitiveImage│
│ SSR data      │                        │ component uses│
│ (link preview)│                        │ client store  │
└───────────────┘                        └───────────────┘
```

two-pronged approach:
1. **SSR** - `+layout.server.ts` fetches flagged images for meta tag filtering (link previews)
2. **client** - moderation store fetches same data for runtime blur effect

### SensitiveImage component

wraps any image that might need blurring:

```svelte
<SensitiveImage src={imageUrl}>
    <img src={imageUrl} alt="..." />
</SensitiveImage>
```

the component:
- checks if `src` matches any flagged image
- applies CSS blur filter if flagged
- shows tooltip on hover: "sensitive - enable in portal"
- respects user's `show_sensitive_artwork` preference

### matching logic

```typescript
function checkImageSensitive(url: string, data: SensitiveImagesData): boolean {
    // exact URL match (for external images)
    if (data.urls.includes(url)) return true;

    // R2 image ID extraction and match
    const r2Match = url.match(/r2\.dev\/([^/.]+)\./);
    if (r2Match && data.image_ids.includes(r2Match[1])) return true;

    const cdnMatch = url.match(/\/images\/([^/.]+)\./);
    if (cdnMatch && data.image_ids.includes(cdnMatch[1])) return true;

    return false;
}
```

### API endpoint

```
GET /moderation/sensitive-images

Response:
{
    "image_ids": ["abc123", "def456"],
    "urls": ["https://cdn.bsky.app/..."]
}
```

returns arrays for SSR compatibility (Sets don't serialize to JSON).

## user experience

### default behavior

- all images matching `sensitive_images` table are blurred
- tracks with an active global `sexual` or `porn` label are absent from
  discovery, search, lists, queues, and shared radio
- the audio endpoint rejects anonymous access to those tracks; authenticated
  listeners must explicitly enable sensitive audio
- tooltip on hover explains how to enable
- link previews (og:image) exclude sensitive images entirely

### opt-in flow

1. user navigates to settings → "privacy & display"
2. uses the sensitive-content master toggle, or changes artwork/audio separately
3. the independent preferences are saved to the database
4. sensitive images unblur and/or adult-labeled audio becomes discoverable and playable

## current limitations

### manual flagging only

the `sensitive_images` table is currently populated manually by admins. this is "whack-a-mole" moderation - we flag images as we discover them.

**future improvements needed:**

1. **perceptual hashing** - hash images at upload time, detect re-uploads of flagged content
2. **AI detection** - integrate NSFW detection API (AWS Rekognition, Google Vision, etc.)
3. **user reporting** - let users flag inappropriate content
4. **artist self-labeling** - let artists mark their own content as sensitive

### audio labels

audio uses the existing signed ATProto labeler rather than a parallel NSFW
table. The canonical global values are:

- `sexual`: sexually suggestive or explicit audio
- `porn`: pornographic audio

both map to the same default-hide policy today. Keeping the assertion and policy
separate means the taxonomy remains interoperable while the product can later
offer finer preferences without relabeling content.

## moderation workflow

### current image process

1. admin discovers inappropriate image (user report, browsing, etc.)
2. admin identifies the image source:
   - R2 upload: extract `image_id` from URL
   - external: copy full URL
3. admin inserts row into `sensitive_images` via SQL or Neon console
4. image is immediately blurred for all users

### current audio process

1. creator self-labels a track or an operator reviews reported audio
2. the moderation service emits a signed `sexual` or `porn` label against the
   track AT URI and CID
3. the backend consumes the active label and applies the listener preference
4. revocation uses the labeler's normal `neg: true` event rather than deleting
   history

### example: flagging an R2 image

```sql
-- image URL: https://images.plyr.fm/images/abc123.jpg
INSERT INTO sensitive_images (image_id, reason, flagged_by)
VALUES ('abc123', 'nudity', 'admin');
```

### example: flagging a Bluesky avatar

```sql
-- avatar URL from artist profile
INSERT INTO sensitive_images (url, reason, flagged_by)
VALUES (
    'https://cdn.bsky.app/img/avatar/plain/did:plc:xxx/bafkrei...@jpeg',
    'nudity',
    'admin'
);
```

## related documentation

- [overview](overview.md) — moderation philosophy and architecture
- [copyright detection](copyright-detection.md) — automated copyright scanning
- [ATProto labeler](atproto-labeler.md) — ATProto label emission
