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

## Account Deletion (Planned)

*   **Goal**: Allow users to permanently delete their account and all associated data (tracks, images, metadata).
*   **Prerequisite**: Users should be encouraged to export their data before deletion.
*   **Implementation**:
    *   Will likely use a similar `Job` based approach for reliability.
    *   Must scrub database records and delete corresponding R2 objects.
