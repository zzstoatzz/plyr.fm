# resumable uploads

how the browser gets a track's bytes to plyr since `feat/resumable-upload-sessions`
(August 2026). the single-request `POST /tracks/` still exists for the SDK and the
integration suite; the web uploader no longer uses it.

## why

`POST /tracks/` held one HTTP request open for the whole transfer and then staged
the bytes to R2 *inside the request* before answering. a 579-second production
upload on August 24 decomposed as 346s of body transfer followed by 231s of `R2
save` — the browser's progress bar sat at 100% with nothing to show, and the
client's fixed 300s `xhr.timeout` (which counts the whole request) fired for an
upload that then succeeded. the artist re-uploaded fifteen minutes later.

the shape is the same one bluesky's video service and stream.place settled on:
the transfer is many short requests, each independently timed out, retried and
measured, and the server acknowledges the bytes the moment it has them.

## the flow

```
browser                                api                              R2 / worker
  │  POST /tracks/uploads {filename,size} │                                  │
  │ ───────────────────────────────────▶ │  create_multipart_upload          │
  │ ◀─ {upload_id, part_size, part_count}│  (private bucket, staged/<id>.ext)│
  │                                      │                                  │
  │  PUT /tracks/uploads/{id}/parts/{n}  │  upload_part, heartbeat job      │  ×N, 3 in flight
  │ ───────────────────────────────────▶ │ ─────────────────────────────▶   │
  │                                      │                                  │
  │  POST /tracks/uploads/{id}/finish    │  validate fields, list_parts,    │
  │  (same form fields, minus file)      │  stage image, then complete      │
  │ ───────────────────────────────────▶ │  multipart, enqueue worker       │
  │ ◀─ {upload_id}                       │                                  │
  │                                      │                                  │
  │  GET /tracks/uploads/{id}/progress   │        run_track_upload(staged=True)
  │  (SSE, unchanged)                    │        phase 0: settle staged bytes
  │                                      │          stream → hash + duration + ALAC
  │                                      │          public/gated: copy_object → audio/<hash>.<ext>
  │                                      │          private:      uploadBlob → PDS
  │                                      │          delete staged/<id>.<ext>
  │                                      │        phases 1–8: unchanged
```

- **parts are 10 MiB, uniform, last one shorter** — R2 requires ≥ 5 MiB and equal
  sizes for every part but the last. the server rejects a part whose length is
  not exactly what its number implies, so a truncated part can never be
  assembled.
- **staged bytes live in the private bucket** under `staged/<upload_id>.<ext>`
  (`StagedUploadKey`). the public bucket is served verbatim from
  `audio.plyr.fm`; a supporter-gated master must never be reachable there, even
  under an unguessable key.
- **`finish` validates the metadata before completing the multipart**, using the
  same `parse_upload_metadata` as `POST /tracks/`; a 400 there, a 409 for a
  missing part, or a 413 for a rejected cover image all leave the parts in place
  and the session open (`GET /tracks/uploads/{id}` lists received parts). the
  multipart is completed only once nothing else can refuse the upload.
- **the worker settles** (`_settle_staged_audio`): the staged object is read
  once onto the worker's disk while its sha256 is computed; duration and the
  ALAC scan run from that local copy (the handler used to do this on its own
  `/tmp`); then a server-side `copy_object` puts the bytes at their content-hash
  key and the staged object is deleted. the worker never re-uploads audio.
  private media goes to the PDS as a blob instead, as before. from
  `_validate_audio` onward nothing knows the upload was resumable — PDS blob
  before record, reserve-then-publish, the jetstream finalize race, the
  optimize task: all untouched.
- **abandoned sessions**: a session is `pending` / phase `transfer` while
  parts arrive (each part heartbeats `updated_at`), so the stuck-upload reaper
  ignores it. `reap_abandoned_transfers` fails sessions idle for 24h and aborts
  their multipart upload; R2 aborts incomplete multipart uploads itself after
  7 days regardless.

## client

`frontend/src/lib/upload-session.ts` is the transport: `startUploadSession`,
`uploadParts` (3 in flight, a 60s *stall* timeout per part — measured from the last progress event, so a slow part is never cut off — plus a 15 min ceiling, 5 attempts with exponential
backoff, progress = acknowledged bytes), `getUploadSession` (which parts the
server holds, for resuming), `finishUploadSession`. it takes an injectable
`send` so its tests exercise the retry and progress logic without a DOM.

`frontend/src/lib/staged-transfer.svelte.ts` wraps the transport as observable
state — `StagedTransfer` with `status`/`loaded`/`total`/`error`, `retry()`
resuming from `received_parts`, `abort()` — and `uploader.svelte.ts` composes
that with the unchanged SSE follow-up: `uploader.stage(file)` starts a
transfer, `uploader.upload(staged | file, …)` waits for it and calls `finish`.
the `/upload` page stages **at submit**, not at file selection: a chosen file
is previewed from the local file (`AudioPreview.svelte`) and nothing leaves
the browser until the user presses upload (#1957 withdrew transfer-on-select —
a mistakenly chosen file must not sit in staging).

`replaceAudio` (`PUT /tracks/{id}/audio`) still uses the single-request path.

## not in scope (yet)

- a PDS that refuses the blob still degrades to R2-only with a portal warning,
  as before; making that a first-class job outcome is a separate change.
- the PDS blob is the *playable* rendition, as before. storing the artist's
  master in the PDS and deriving delivery renditions from the mirror is the
  larger storage-semantics change this transport makes possible.
