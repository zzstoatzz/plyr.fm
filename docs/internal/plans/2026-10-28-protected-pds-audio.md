# Protected audio on the artist's PDS

Date: 2026-10-28. Goal: staging implementation, real-service smoke coverage, then documentation reconciliation. Production promotion is excluded.

## Contract

Public/unlisted metadata and protected audio are independent. Spaces-capable artists store protected audio in an artist-owned public-read Space restricted to the deployed plyr OAuth client. The backend obtains app-only credentials; anonymous listeners and listeners on PDSes without Spaces can stream through plyr. Member-private tracks retain their existing reader-delegation path. Downloads remain an application permission, not a promise to prevent recording playback.

An unsupported artist PDS may use private R2 only after explicit per-upload acceptance. A capable PDS refusing the write is an error, never permission to fall back. Existing catalog audio is not migrated automatically.

## Implementation

1. Extend credential minting for app-only public-read Spaces. Create the dedicated playback Space with public read, owner/member-list write, and exact client allow-list. Validate an existing Space's policy before reusing it.
2. Persist protected asset refs separately from public blob refs and metadata Space refs. Public records retain an `audioSpace` URI string; protected asset records retain the blob references. Snapshots retain the asset version they describe.
3. Write source audio and its protected record to the PDS before attempting the playback mirror. Failure to mirror or clean staging must not undo successful PDS ownership. Remove redundant mandatory MP3 encoding for already playable inputs. Keep encoding heartbeats alive.
4. Support app-authorized PDS reads in streaming, download/export, source recovery, replacement, restore, publishing changes, ingestion and deferred optimization. Keep gate/download authorization before serving bytes. Never publish a protected BlobRef through public metadata.
5. Add supported-versus-granted capability handling and the minimal fallback acceptance UI across upload callers.

## Validation

Use real local HTTP/PDS tests plus database tests for authorization, credential renewal, mirror failure, duplicate/failed publication cleanup, replacement, snapshots/restore, deletion, policy changes, export and ingestion. Run backend/frontend suites and contract checks, self-review the PR, then merge to staging.

Start staging workers explicitly. Use only disposable, tagged integration-test uploads. Smoke with real OAuth, Spaces-capable and non-Spaces accounts, anonymous playback, Range/HEAD, unauthorized app/user requests, private public-getBlob denial, master recovery, replacement/restore/delete and mirror/source failure cases. Record exact results, clean fixtures, inspect deployed UI at relevant sizes/themes, and sweep current and historical docs for statements that need reconciliation. Leave production unchanged.
