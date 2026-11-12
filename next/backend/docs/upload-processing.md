# upload processing

This contract extends the Next public/open upload journey to retain an original
and publish an MP3 playback rendition. Implementation is staged: the Rust
execution seam precedes the audio Worker owner-state integration and client.
It is not enabled by deploying source alone.

## ownership and publication

The client reserves one canonical record URI before uploading, and alone writes
that record. The audio owner's Durable Object retains the immutable source,
processing recipe, output reservation, attempts and receipts. The existing Rust
staging transcoder executes disposable attempts; it owns no PDS credentials.
The exact-CID mirror remains unchanged.

Source admission remains 1.5 GiB. Processing uses `mp3-320k-44100-v1`.
Source bytes plus the explicitly admitted output budget count against the
owner's unfinished-storage quota. Compressed input does not bound output size.
Output exceeding its budget fails without publishing a truncated rendition;
the original and the same record reservation remain recoverable.

The ordinary `audioUrl` serves the rendition only after canonical activation.
A service-owned `/original` endpoint serves the retained original as an
attachment, with HEAD/Range support and the same publication gate. The service
manifest advertises its type, name and size. Both copies become public together
under `downloadPolicy: open`; consent must state public permanence. No UUID is
placed in `originalFileId`, no new lexicon field is introduced, and no blob is
fabricated. The original reference is service metadata, not portable metadata
inside the canonical record. Protected/restricted processing is separate work.

## execution protocol

The DO persists a generation and lease before dispatching a small authenticated
start request. Its immutable attempt includes upload ID, generation, exact source
size, output budget and recipe. A per-attempt capability authorizes only that
generation's source, heartbeat, output parts and completion; it is never logged
or sent to the client. The transcoder callback origin is configured, never
supplied as an arbitrary request URL.

Rust pulls the source into a temporary file, encodes to a second temporary file,
and uploads sequential 10 MiB output parts. It never buffers a whole file.
Part sizes and hashes are checked before R2 receipts become authoritative.
Completion includes exact output size and the complete ordered part set.
The DO reconciles lost part/completion replies through persisted digests and
R2 object metadata before making the rendition ready.

One execution slot bounds Rust resource use. Duplicate active dispatches are
idempotent; other attempts receive a retryable busy response. Heartbeats extend
the DO lease. Loss of authority stops the attempt and kills ffmpeg. An expired
lease permits a fresh generation; stale callbacks cannot change that generation.
Rust restarts can require re-encoding, but never a new canonical record key.
Automatic attempts are bounded, followed by explicit retry. Alarms do short
lease/reconciliation/dispatch work, never wait for an encode.

Rust's individual attempt deadline is two hours, with 20-second heartbeats and
a 15-second heartbeat request timeout. The owner must fence expired generations
and reject heartbeats after completion. Cloud full-size tests must establish
whether this execution budget is sufficient before enabling the journey.

Before reading input, the executor checks available scratch filesystem bytes
against the entire admitted source plus output budget. One attempt may need
3 GiB of free scratch space, in addition to the image and other runtime files.
This check does not reserve disk against legacy concurrent jobs: later I/O
failures remain recoverable. Full-size cloud acceptance must record free space
before dispatch and peak disk use; it cannot assume a Fly image's nominal disk
size is all available to the job.

The new encoder allows only file/pipe protocols and mp3, wav, flac, ogg, mov,
aac, aiff and matroska/webm demuxers. This covers the legacy `AudioFormat`
contract (including `.aif` and recorder WebM) plus the Next AAC admission.
Playlist/concat inputs are rejected. MOV external references and
absolute external paths retain ffmpeg's disabled defaults; the generic command
does not enable them. [FFmpeg documents these defaults](https://ffmpeg.org/ffmpeg-formats.html).
The regression verifies an HTTP-referencing manifest makes zero requests and a
local concat manifest cannot read another file. These restrictions are specific
to this new execution path; legacy transcoding is unchanged.
The Docker build runs the executor tests with its pinned Rust 1.85 and static
ffmpeg 7.0.2, so host-toolchain results alone cannot satisfy the release check.

## runtime constraints

The existing `/transcode` handler writes input/output to disk and responds with
`Body::from_stream(ReaderStream::new(file))`. It sets no Content-Length. The new
path obtains output length from file metadata and sends bounded multipart parts;
the legacy endpoint and its response remain unchanged.

Cloudflare documents a default 100 MiB outbound DO request-body limit, which
streaming and multipart form encoding do not bypass. Therefore Rust pulls the
source rather than receiving a 1.5 GiB DO POST. DO alarms have a 15-minute wall
limit; `waitUntil` only adds 30 seconds after disconnect. R2 multipart streams
require known lengths, with uniform parts except the final part.

- [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Workers invocation limits](https://developers.cloudflare.com/workers/platform/limits/)
- [R2 multipart API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)

## staging wiring and release isolation

`deploy-staging.yml` invokes `deploy-transcoder.yml` with target `staging` on
main changes. `deploy-prod.yml` invokes target `production` only on a published
release. Source pushes and merges do not promote production.

The new route requires `FLY_APP_NAME=plyr-transcoder-staging`,
`NEXT_PROCESSING_ORIGIN` (the Next audio HTTPS origin) and
`NEXT_PROCESSING_AUTH_TOKEN` (at least 32 bytes, sent by the DO in
`X-Processing-Key`). Missing
configuration leaves the route absent; partial or non-staging configuration
must fail closed. Existing `/transcode` behavior is unchanged.

Before enabling background processing, staging's current auto-stop/minimum-zero
configuration must change to keep its single processing machine alive. Callback
traffic alone is not an inbound request keeping the Fly machine active. This
staging-only capacity/configuration change and secret wiring require review;
production settings and secrets are not changed by this slice.

## acceptance

Small deterministic fixtures cover duplicate dispatch, capacity, source mismatch,
lease loss, stale completion, output budget, uncertain receipts and cleanup.
Cloud acceptance must exercise a synthetic 1.5 GiB source through the actual
staging Rust service and R2 multipart path, verify bounded memory and both
original and rendition downloads after fixture publication, then clean up exact
fixture objects and records. Run only while shared staging integration is idle.
An HTTP sink or emulator alone does not establish deployed R2 acceptance.
