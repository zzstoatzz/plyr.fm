# Offboarding & Data Export

Plyr.fm provides tools for users to export their data and manage their presence on the platform. This document outlines the architecture and workflows for these features.

## Data Export

Users can download a ZIP archive containing all their uploaded tracks in their original format.

### Workflow

1.  **Initiation**:
    *   User clicks "Export" in the portal.
    *   Frontend calls `POST /exports/media`.
    *   Backend creates a `Job` record (type: `export`) and starts a background task.
    *   Returns an `export_id`.

2.  **Processing**:
    *   Backend queries all tracks for the user.
    *   Backend streams files from R2 storage into a ZIP archive in memory (using a stream buffer to minimize memory usage).
    *   As tracks are processed, the job progress is updated in the database.
    *   The final ZIP file is uploaded to R2 under the `exports/` prefix.
    *   The R2 object is tagged with `Content-Disposition` to ensure a friendly filename (e.g., `plyr-tracks-2024-03-20.zip`) upon download.

3.  **Completion & Download**:
    *   Frontend polls the job status via SSE at `/exports/{export_id}/progress`.
    *   Once completed, the job result contains a direct `download_url` to the R2 object.
    *   Frontend triggers a browser download using this URL.

### Storage & Cleanup

*   **Location**: Exports are stored in the `audio` bucket under the `exports/` prefix.
*   **Retention**: These files are temporary. An R2 Lifecycle Rule is configured to **automatically delete files in `exports/` after 24 hours**.
    *   This ensures we don't pay for indefinite storage of duplicate data.
    *   Users must download their export within this window.

## Account Deletion

Users can permanently delete their account and all associated data. This is a synchronous, interactive process.

### What Gets Deleted

#### Always Deleted (plyr.fm infrastructure)

| Location | Data |
|----------|------|
| **PostgreSQL** | tracks, albums, likes (given), comments (made), preferences, sessions, queue entries, jobs |
| **R2 Storage** | audio files, track cover images, album cover images |

#### Optionally Deleted (user's ATProto PDS)

If the user opts in, we delete records from their Personal Data Server:

| Collection | Description |
|------------|-------------|
| `fm.plyr.track` / `fm.plyr.dev.track` | track metadata records |
| `fm.plyr.like` / `fm.plyr.dev.like` | like records |
| `fm.plyr.comment` / `fm.plyr.dev.comment` | comment records |

> **Note**: ATProto deletion requires a valid authenticated session. If the session has expired or lacks required scopes, ATProto records will remain on the user's PDS but all plyr.fm data will still be deleted.

### Workflow

1. **Confirmation**: User types their handle to confirm intent
2. **ATProto Option**: Checkbox to opt into deleting ATProto records
3. **Processing**:
   - Delete R2 objects (audio, images)
   - Delete database records in dependency order
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
