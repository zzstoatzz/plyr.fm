---
title: "image format handling"
---

## supported formats

| format | tracks | albums/playlists | notes |
|--------|--------|-----------------|-------|
| JPG/JPEG | yes | yes | normalized to `ImageFormat.JPEG` |
| PNG | yes | yes | |
| WebP | yes | yes | |
| GIF | yes | **no** | animated GIF artwork supported for tracks only |

albums and playlists restrict covers to `COVER_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}` — GIF is excluded.

source: `_internal/image.py` (format enum), `_internal/image_uploads.py` (validation + `COVER_EXTENSIONS`)

## validation

validation uses `ImageFormat.validate_and_extract(filename, content_type)`:

1. **content-type preferred over filename** — handles iOS HEIC→JPEG conversions where the browser sends `image/jpeg` content-type but the file still has a `.heic` extension
2. falls back to filename extension if content-type is missing or unrecognized
3. returns `(format, is_valid)` tuple — callers check `is_valid` before proceeding

## size limits

| constraint | value | source |
|-----------|-------|--------|
| max image file size | 20 MB | `image_uploads.py:MAX_IMAGE_SIZE_BYTES` |
| chunk read size | 8 MB | `utilities/hashing.py:CHUNK_SIZE` |
| thumbnail dimensions | 96 × 96 px | `thumbnails.py:generate_thumbnail()` |

no minimum dimensions enforced. no maximum pixel dimensions enforced — only file size.

## processing pipeline

1. **validate** format (content-type → filename fallback)
2. **stream** image data in chunks with 20MB cap
3. **store** original at full resolution in R2 (`images/{file_id}.{ext}`)
4. **generate thumbnail** — center-crop to square, resize to 96×96, encode as WebP (quality 80, LANCZOS resampling)
5. **store thumbnail** in R2 (`images/{file_id}_thumb.webp`)
6. **moderate** (non-blocking) — scan via moderation service, flag but don't reject

`file_id` is SHA256 of image bytes, truncated to 16 characters.

## display behavior

all display contexts use square containers with `object-fit: cover`:

| context | size | source |
|---------|------|--------|
| track cards (horizontal lists) | 48 × 48 px | `TrackCard.svelte` |
| track items (full-width lists) | ~64 × 64 px | `TrackItem.svelte` |
| player artwork | 120–200 px | responsive |
| detail pages | 200–300 px | responsive |

`object-fit: cover` **center-crops** non-square images. a tall portrait image loses the top and bottom; a wide landscape loses the sides. there's no pan/zoom or crop preview during upload.

## known issues

### same-image re-upload deletion (fixed in #1176)

when editing a track and re-submitting the same image file, the identical content hash produced the same `image_id`. the old cleanup logic unconditionally deleted the previous image — which was the just-uploaded file. fix: skip deletion when `old_image_id == new_image_id`.

confirmed via Logfire spans: user `jdhitsolutions.com` hit this 3 times on track 833 (2026-03-20/21). the image survived the third attempt only because the previous deletes had already removed the old file, so the cleanup found nothing to delete.

### no dimension guidance for creators

creators have no guidance on recommended image dimensions or aspect ratio. since all display contexts are square with `object-fit: cover`, non-square artwork gets cropped without warning. the upload form accepts `image/*` with no preview of the crop result.

## recommendations for public docs

the `docs/artists.md` ("for creators") page should mention:

1. **recommended dimensions**: square (1:1 aspect ratio), at least 500×500 px for best quality across all display sizes
2. **supported formats**: JPG, PNG, WebP, GIF (GIF for track artwork only — album/playlist covers don't support GIF)
3. **max file size**: 20 MB
4. **cropping behavior**: non-square images are center-cropped to square — use square images to control what's visible

this could go in the "your first upload" section under step 2/3, or as a dedicated "artwork guidelines" subsection.

the API reference (`docs/developers/api-reference/tracks/uploads.md`) should also document the `image` parameter's accepted formats and size limit.
