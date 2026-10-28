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

## Staging completion evidence

Implementation merged in [#2233](https://github.com/zzstoatzz/plyr.fm/pull/2233),
staging commit `02ed1cd5d09ec923e84e251fd3b1135f4f53ef02`.
[Client #44](https://github.com/zzstoatzz/plyr-python-client/pull/44) merged after
its reciprocal compatibility check passed. The temporary client-head pin in the
API check is removed in the documentation sweep; strict checks remain unchanged.
No package release or production promotion is implied.

- Local backend: 2,060 passed, 26 existing skips. Frontend: 385 passed; types,
  lint, accessibility, API contracts and pre-merge browser checks passed.
- Real-service protected audio harness: **29 checks passed**, including a real
  private R2 deletion, PDS byte recovery, indexing, lifecycle/refcounts, explicit
  non-Spaces consent, interrupted two-part 11.5 MB upload, and `.aif` optimization.
- All harness tracks/source records and temporary API tokens were cleaned up.
  ZDS does not implement `deleteSession`; its separate PDS inspection-session
  teardown returned 404 and is recorded as a protocol limitation.
- Real OAuth browser matrix: **four clean passes**, at 1280px and 390px in
  light/dark themes, with touch on mobile. Each checked upload/storage notice,
  PDS ownership, anonymous actual playback and Range, download refusal, tag
  analysis, strict browser/API error checks and cleanup. An additional mobile
  run verifies that cleanup waits for the play write.
- Full staging integration suite: still running, including the advertised
  1.5 GiB upload boundary; add its exact result before closing this goal.

The first stress run caused an API-machine OOM while supplemental maintenance
Python competed with concurrent uploads. Fly restarted it; the isolated rerun
kept health passing and caused no further restart. Maintenance now requires an
explicit temporary machine, bounded remote execution and guarded fixture-only
mutation. The temporary machine was destroyed. Failed browser fixtures and
exposed test sessions were cleaned/revoked; cleanup logging now omits request
headers. Short synthetic audio and hard browser navigations also caused false
failures in tag analysis and queue writes; the final browser smoke uses a valid
12-second audio fixture and real application links, preserving strict error
checks.

See the [current contract and operations](../architecture/protected-pds-audio.md).
Production remains excluded until staging evidence and the docs sweep are reviewed.
