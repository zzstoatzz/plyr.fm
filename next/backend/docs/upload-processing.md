# upload processing

This contract extends the Next public/open upload journey to retain an original
and publish an MP3 playback rendition. Implementation is staged: the Rust
execution seam and audio Worker owner-state integration precede the client.
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
Completion includes exact output size, integer duration and the complete ordered
part set. Rust probes only its generated MP3, with a separate 15-second deadline
and at most 64 bytes of stdout. Duration rounds to seconds for the existing track
field; it is service metadata until the client writes the canonical record.
The DO reconciles lost part/completion replies through persisted digests and
R2 object metadata before making the rendition ready.

One execution slot bounds Rust resource use. Duplicate active dispatches are
idempotent; other attempts receive a retryable busy response. Heartbeats extend
the DO lease. Loss of authority stops the attempt and kills ffmpeg. An expired
lease permits a fresh generation; stale callbacks cannot change that generation.
Rust restarts can require re-encoding, but never a new canonical record key.
Automatic attempts are bounded, followed by explicit retry. Alarms do short
lease/reconciliation/dispatch work, never wait for an encode.

The owner allows three automatic generations. Each has a 90-second lease and
is checked every 30 seconds; an authenticated heartbeat renews the lease within
the two-hour attempt lifetime. A failed generation must finish multipart/object
cleanup before another can consume its output reservation. Lost abort replies
retain that reservation until cleanup succeeds or R2 explicitly reports
`NoSuchUpload` (10024). An unavailable bucket or an absent object alone does not
prove the multipart upload is gone. The Worker recognizes the action-specific
error representation used by workerd; the documented absence code is listed in
[R2 errors](https://developers.cloudflare.com/r2/api/error-codes/).

User status keeps the same upload ID and canonical URI throughout `processing`.
It returns no playback URL until the rendition is ready. Explicit retry uses
`POST /v1/uploads/{ownerHash}/{uploadId}/retry-processing`; completed-source cancellation
still reports a recovery conflict and retains the original. Callback requests
use `/v1/processing/{uploadId}/{generation}/` followed by `source`, `heartbeat`,
`parts/{number}` or `complete`, with an owner/generation/expiry-bound capability
distinct from upload admission. No processing capability reaches the client.

The executor reports a bounded `failed` callback with either
`output_budget_exceeded` or `executor_failed`, never arbitrary error text.
The owner also records `lease_expired` when an unreported attempt loses its lease.
Only the active generation may report a failure; a completion already being
reconciled cannot be changed into a failure. Status exposes `processingFailure`.
Known output-budget exhaustion cleans partial output, retains the original and
reservation, stops automatic attempts and rejects explicit retry with the same
budget. Other failures retain bounded retries. If the failure callback cannot be
delivered, lease recovery still applies; it cannot infer an undelivered reason.
Increasing the immutable budget is not implemented and must not be advertised as
a recovery action. Processing UI remains gated on handling this distinction.

Authenticated upload status includes `processingGeneration` once an attempt
exists. A fixture can retain its exact private rendition key
`processing/{ownerHash}/{uploadId}/{processingGeneration}` without recording a
capability. Published manifests distinguish processed uploads with
`processed: true`; raw uploads report false and need no original/rendition choice.

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

Executor logs bind `scratch_available_bytes` before input and
`owned_scratch_peak_file_bytes` after encoding to the upload UUID and generation.
The latter sums the two monotonically growing source/output files' logical byte
lengths; it is owned scratch usage, not whole-machine peak disk or filesystem
allocation overhead. No media, credentials or capabilities enter these logs.
Successful cloud fixtures remove only their exact source and observed generation
after publication. Unfinished failures retain objects and their reservation
artifact for fenced diagnosis; never delete bytes under an active executor.

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

The coordinator separately requires `UPLOAD_PROCESSING_ENABLED=true` before it
admits a recipe/output budget. The audio Worker requires
`PROCESSING_TRANSCODER_URL=https://plyr-transcoder-staging.fly.dev/v1/processing`
and `PROCESSING_TRANSCODER_KEY` matching the executor token. Otherwise recipe
admission fails before source reservation. None of these settings is enabled
by this implementation. AIFF/AIF and WebM admission requires processing; the
existing direct-upload format contract remains unchanged.

Before enabling background processing, staging's current auto-stop/minimum-zero
configuration must change to keep its single processing machine alive. Callback
traffic alone is not an inbound request keeping the Fly machine active. This
staging-only capacity/configuration change and secret wiring require review;
production settings and secrets are not changed by this slice.

## acceptance

Local owner fixtures exercise actual workerd/R2-emulator admission, retained
source, rendition parts/completion, eviction, publication gates, range downloads,
lease fencing, a held stale part, lost part/completion replies and ambiguous
abort recovery. They use a stub executor dispatch, not a deployed Rust/R2 pair.
Executor fixtures independently cover format compatibility, source authority,
mid-flight lease loss, output bounds and multipart completion. Full owner/executor
integration must still verify duplicate dispatch, source mismatch, stale
completion and cleanup against the deployed services.
Cloud acceptance must exercise a synthetic 1.5 GiB source through the actual
staging Rust service and R2 multipart path, verify bounded memory and both
original and rendition downloads after fixture publication, then clean up exact
fixture objects and records. Run only while shared staging integration is idle.
An HTTP sink or emulator alone does not establish deployed R2 acceptance.

## enabling the staged journey

Provision only after the config/workflow PR is published and reviewed. The new
credential's canonical SOPS key is `plyr_next.processing_auth_token`; its GitHub
Actions consumer is `PLYR_NEXT_PROCESSING_AUTH_TOKEN`. The staging transcoder
workflow stages that value as Fly `NEXT_PROCESSING_AUTH_TOKEN`; the Next audio
workflow sends the same value as Worker `PROCESSING_TRANSCODER_KEY`. Neither
consumer reuses upload admission or mirror credentials. Values travel through
stdin or a mode-0600 temporary file and are never logged. The existing local
secret sync does not manage GitHub/Fly/Worker consumers: provision the GitHub
value from SOPS, run the two reviewed workflows, and verify authenticated
operation. Rotation uses the same sequence while admission is disabled; it is
not an automatic multi-consumer rotation.

The executor deployment keeps exactly one staging machine in `iad`, with
`--ha=false`, explicit count one, minimum one and auto-stop disabled. Before
this change the app had two stopped machines; minimum one alone would not
remove the extra machine. Production deploy arguments and configuration are
unchanged. The hourly staging rest job stops only the legacy backend's worker
and jetstream groups, not the transcoder.

Keep coordinator `UPLOAD_PROCESSING_ENABLED` absent until the disabled owner,
typed-failure handling and receipt metadata have deployed, the Worker/executor
configuration is verified, and no shared staging test is active. Enable that
coordinator flag last through a separate reviewed configuration change. Run
small then full-size synthetic acceptance, retaining operation/generation
receipts and exact cleanup evidence. Enable the client only after acceptance.
On failure, disable admission first, retain unfinished objects for diagnosis,
fence active attempts before changing executor capacity, and revert the warm
staging settings if the trial is abandoned. Never delete bytes under an active
executor or promote production as part of this sequence.
