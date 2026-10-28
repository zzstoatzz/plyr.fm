---
title: "offboarding & data export"
---

Plyr.fm provides tools for users to export their data and manage their presence on the platform. This document outlines the architecture and workflows for these features.

## Data Export

Users can download a ZIP archive containing all their uploaded tracks in their original format.

Protected PDS source recovery described here is deployed to staging and awaits
production promotion. An owner can recover a track's original through
`GET /audio/{file_id}/download`, including when listener downloads are off. The
export follows the same original-source choice; an optimized MP3 does not replace
the artist's retained source file.

### Workflow

1.  **Initiation**:
    *   User clicks "Export" in the portal.
    *   Frontend calls `POST /exports/media`.
    *   Backend creates a `Job` record (type: `export`) and starts a background task.
    *   Returns an `export_id`.

2.  **Processing**:
    *   Backend queries all tracks for the user.
    *   Backend retrieves originals into temporary files and builds the ZIP on disk.
    *   Protected `audioSpace` tracks are read from the artist's PDS using app credentials, including when the private R2 mirror is missing. Member-private Space tracks require the owner's authenticated session. Other tracks use their PDS blob or R2 source as appropriate.
    *   If any original cannot be retrieved, the export fails instead of publishing a partial archive.
    *   As tracks are processed, the job progress is updated in the database.
    *   The final ZIP file is uploaded to R2 under the `exports/` prefix.
    *   The R2 object is tagged with `Content-Disposition` to ensure a friendly filename (e.g., `plyr-tracks-2024-03-20.zip`) upon download.

3.  **Completion & Download**:
    *   Frontend polls the job status via SSE at `/exports/{export_id}/progress`.
    *   Once completed, the job result contains an authenticated `/exports/{export_id}/download` URL.
    *   That owner-only endpoint redirects to a short-lived signed R2 URL.

### Storage & Cleanup

*   **Location**: ZIPs are stored in the private audio bucket under `exports/`; they have no public bucket URL.
*   **Access**: The download endpoint checks the job owner's DID and issues a fresh signed URL after authorization. The progress stream reports job state; its completion URL points to that authenticated download endpoint.
*   **Retention**: Treat exports as temporary. Bucket lifecycle policy controls object retention; signed URL expiry controls access through an issued link.

## Account Deletion

Users can remove their plyr.fm account data through a synchronous, interactive
request. Remote storage cleanup is best-effort and has the protected-audio
limitation below; it is not a guarantee that every object has been erased.

### Protected audio limitation before promotion

Account deletion does not yet collect protected Space source records, retained
revision sources, or private-bucket originals/mirrors. Its optional PDS cleanup
collects track metadata URIs; its R2 cleanup uses the ordinary public-object path.
Deleting protected tracks individually before deleting the account uses the
source-aware cleanup path instead. Keep PDS sources when the user has not opted
into PDS deletion. Reconcile the account-wide path before promoting protected
PDS audio; tracked in [#2235](https://github.com/zzstoatzz/plyr.fm/issues/2235).

### What Gets Deleted

#### App data removed and storage cleanup attempted

| Location | Data |
|----------|------|
| **PostgreSQL** | tracks, albums, likes (given), comments (made), preferences, sessions, queue entries, jobs |
| **R2 Storage** | ordinary public audio and cover-image cleanup attempted after commit; protected/private sources are not fully covered |

#### Optionally Deleted (user's ATProto PDS)

If the user opts in, we delete records from their Personal Data Server:

| Collection | Description |
|------------|-------------|
| `fm.plyr.track` / `fm.plyr.dev.track` | track metadata records |
| `fm.plyr.like` / `fm.plyr.dev.like` | like records |
| `fm.plyr.comment` / `fm.plyr.dev.comment` | comment records |

> ATProto deletion requires a valid authenticated session. If it expires or lacks
> the required scopes, remote records can remain after the database rows are
> removed. The protected-source limitation above also applies.

### Workflow

1. **Confirmation**: User types their handle to confirm intent
2. **ATProto Option**: Checkbox to opt into deleting ATProto records
3. **Processing**:
   - Delete database records in dependency order
   - Attempt ordinary R2 audio/image cleanup after commit
   - If opted in: delete ATProto records via PDS API
4. **Session Cleanup**: All sessions invalidated, user logged out

### API

```
DELETE /account/
```

**Request Body**:
```json
{
  "confirmation": "handle.bsky.social",
  "delete_atproto_records": true
}
```

**Response** (success):
```json
{
  "deleted": {
    "tracks": 5,
    "albums": 1,
    "likes": 12,
    "comments": 3,
    "r2_objects": 11,
    "atproto_records": 20
  }
}
```

### Important Notes

- **Irreversible**: There is no undo. Export data first if needed.
- **Likes received**: Likes from other users on your tracks are deleted when your tracks are deleted.
- **Comments received**: Comments from other users on your tracks are deleted when your tracks are deleted.
- **ATProto propagation**: Even after deletion from your PDS, cached copies may exist on relay servers temporarily.
