# postmortem: 4-day silent worker outage (audio uploads broken) 2026-05-06 → 2026-05-10

## summary

the docket worker process group on `relay-api` OOM-killed itself out of fly's auto-restart budget on **2026-05-06 18:56 UTC**. fly's restart policy (`on-failure` with `max_retries: 10`) gave up after 10 consecutive kills and left the worker machine `stopped`. for the next **3 days, 23 hours, 30 minutes** every track upload's `POST /tracks/` returned 200 and queued a `run_track_upload` task into Redis, but no worker existed to drain it. uploads sat at "uploading to storage… 100%" forever. the outage was discovered when `@cameron.stream` reported it on bsky on 2026-05-10 17:23 UTC; it was resolved at 19:02 UTC with `fly machine start`.

at least three users were affected: `@just.cameron.stream` (6 stuck uploads), `@flo.by` (2), and the maintainer (1). of the 9 stranded jobs, 3 recovered when the worker came back; 6 were unrecoverable because the user's OAuth session had expired between when the upload was staged and when the task finally got to run.

the proximate cause was OOM at the worker's 2 GB memory cap. the structural cause is that the upload pipeline buffers the **entire audio file** in worker memory at four distinct points (R2 read, transcode result, PDS `uploadBlob`, CLAP embedding base64). on long-form audio (90-min podcast = ~900 MB WAV), `concurrency=10` task fan-out at cold-start crosses 2 GB easily.

## timeline (UTC)

| time | event |
|------|-------|
| 2026-05-06 18:56:21 | last successful `run_track_upload` span (trace `019dfea5f07ebd920a0158ed521c54f8`). |
| 2026-05-06 18:56:42 | worker `initializing docket worker` — first restart of the OOM loop. |
| 2026-05-06 18:56 – 19:31 | 10 init → ready → silent-death cycles, ~5 min apart. each one OOM-killed (exit_code=137, oom_killed=true). |
| 2026-05-06 19:31:55 | last worker init log. fly hits `restart.policy.max_retries = 10` and stops trying. machine state: `stopped`. |
| 2026-05-06 → 2026-05-10 | **silent outage.** `POST /tracks/` keeps queuing `run_track_upload` tasks; nothing consumes them. 9 user uploads strand. |
| 2026-05-10 17:23 | `@cameron.stream` reports the outage on bsky. |
| 2026-05-10 18:58:23 | maintainer reproduces locally; upload also strands. |
| 2026-05-10 19:02:25 | `fly machine start` on the worker. |
| 2026-05-10 19:02:48 | worker OOM-kills again 23 s after start (cold-start backlog drain at concurrency=10). |
| 2026-05-10 19:02:49 | fly auto-restarts. this restart survives. queue starts draining. |
| 2026-05-10 19:08:26 | maintainer marks 7 stale `processing` jobs as failed in DB so the frontend stops showing indefinite progress toasts. |
| 2026-05-10 19:09 – 19:09:36 | three of the 9 stranded jobs complete after all (Cameron's most recent + 2 of flo.by's) — they overrode the failed-marker UPDATE because the worker was actively writing progress. |
| 2026-05-10 19:15:01 | worker OOMs again — confirms 2 GB is undersized for the post-cold-start fan-out, not just for the initial drain. |

## root causes

### 1. upload pipeline buffers full audio bytes (the structural bug)

four distinct points held the entire file in worker memory:

- **R2 read**: `R2Storage.get_file_data()` does `await body.read()` and returns `bytes` (`backend/src/backend/storage/r2.py:333`).
- **transcode source spool**: `await get_file_data(...)` then `spool.write(source_data)` (`backend/src/backend/api/tracks/uploads.py:383, 423`).
- **transcode result**: transcoder client returned `response.content` as `bytes`, worker re-uploaded with `BytesIO(result.data)` (`backend/src/backend/_internal/clients/transcoder.py:127`, `uploads.py:462`).
- **PDS `uploadBlob`**: `upload_blob` accepted `bytes`/`BinaryIO` only and passed it as `content=` to httpx — single in-memory blob, not an iterator (`backend/src/backend/_internal/atproto/client.py:375-386`).
- **CLAP embedding (worst offender)**: the worker downloaded the entire R2 audio, base64-encoded it (× 1.33), and POSTed it as JSON to Modal — even though the Modal endpoint only uses the **first 30 seconds** of audio (`services/clap/app.py:121-124`).

with `concurrency=10` and post-upload fan-out (scan_copyright + classify_genres + generate_embedding all running per upload), each in-flight upload could be holding the audio bytes 3–5 times simultaneously. on a long-form file this trivially crosses 2 GB.

### 2. fly restart policy gave up after 10 OOMs

worker machine config: `"restart": {"policy": "on-failure", "max_retries": 10}`. after 10 consecutive OOMs in the cold-start backlog drain, fly stopped trying and left the machine `stopped`. for a singleton stateful worker this is the wrong policy — there's no situation where giving up improves outcomes.

### 3. nothing observed the worker's death

three independent gaps any one of which would have surfaced the outage in minutes:
- **no logfire alert** on "no `run_track_upload` spans in the last N minutes." we have HTTP error rate alerts but nothing that watches for *absence* of a worker-emitted span.
- **no fly health check on the worker process group**. the existing health check is scoped to `[http_service]`, which only applies to the `app` group. a worker check pinging a tiny TCP listener on the worker would have triggered fly to restart it; it would not have helped *here* because the worker was already exhausted out of fly's retry budget, but it would catch a stuck-loop variant.
- **no postgres-side reaper** for upload jobs stuck in `processing` past a reasonable wall-clock budget. the `jobs` table is the durable record of what users want done; nothing watches it.

## impact

- **duration**: 3 days 23 hours 30 minutes (May 6 18:56 UTC → May 10 19:02 UTC).
- **scope**: 100% of new track uploads.
- **user impact**: complete failure to upload, no error message — frontend stuck on "uploading to storage… 100%" indefinitely. some users retried multiple times; others gave up.
- **data loss**: 6 of 9 stranded uploads unrecoverable because OAuth sessions expired before the worker came back. user-visible loss: the lossless source bytes were preserved in R2 (still are) but the user must redo the upload to get a track row + PDS record.
- **detection**: external — user tweet, not internal monitoring.
- **recovery**: manual `fly machine start`, then a follow-up `fly machine start` after a second OOM at 19:15.

## what this PR ships

end-to-end streaming for the audio path, plus a regression test that fails any future PR that re-introduces buffering on long-form audio.

| change | file(s) | what it eliminates |
|--------|---------|--------------------|
| `StorageProtocol.stream_file_data()` (async iter of chunks) + `head_file()` (size for Content-Length) | `backend/src/backend/storage/{protocol,r2}.py` | the `bytes`-returning `get_file_data` call site |
| `upload_blob(body_factory, content_length, content_type)` keyword form; existing `data=` form retained for small blobs (artwork, profile avatars) | `backend/src/backend/_internal/atproto/client.py` | full file held in memory before PDS POST |
| `_signed_streaming_post` helper that supports DPoP + body factories per attempt (the upstream `make_authenticated_request` retries with the same kwargs, exhausting an async iterator) | `backend/src/backend/_internal/atproto/client.py` | inability to retry streaming uploads on DPoP nonce mismatch |
| transcoder client streams response → /tmp via `httpx.AsyncClient.stream` + `aiofiles`, returns `output_path` not `bytes` | `backend/src/backend/_internal/clients/transcoder.py` | full transcoded blob held in memory |
| `_transcode_audio` streams R2 → /tmp source, runs transcoder, streams /tmp → R2 via existing `R2.save` (which streams) | `backend/src/backend/api/tracks/uploads.py` | full lossless source held in memory |
| `_upload_to_pds` streams R2 → PDS uniformly (drops the special transcoded-data branch since the transcoded file is now in R2 like everything else) | `backend/src/backend/api/tracks/uploads.py` | full playable file held in memory before PDS |
| Modal CLAP service accepts `audio_url` and pulls a Range-limited slice itself; client passes the URL through | `services/clap/app.py`, `backend/src/backend/_internal/clients/clap.py`, `backend/src/backend/_internal/tasks/ml.py`, `scripts/backfill_embeddings.py` | full file downloaded to worker + base64 encoded × 1.33 just to ship to Modal |
| migrate-to-PDS, restore-revision, PDS backfill task | `backend/src/backend/api/tracks/{mutations,revisions}.py`, `backend/src/backend/_internal/pds_backfill_tasks.py` | three more `get_file_data` callers buffered the file before PDS upload |
| long-form regression test: 60-min mono WAV (~150 MB) generated via ffmpeg lavfi at fixture time, uploaded through real API, polled to completion | `backend/tests/integration/test_longform_upload.py`, `backend/tests/integration/utils/audio.py` | future PRs that re-buffer will fail this test instead of an angry user tweet |
| CI integration-tests timeout 15 min → 30 min | `.github/workflows/integration-tests.yml` | accommodates the long-form regression test |

`TranscodeInfo.transcoded_data: bytes` is removed — nothing reads it now that the worker streams from R2 instead.

## what this PR does NOT ship (deliberate, follow-up tasks)

these would have prevented or shortened the outage independently of the streaming fix; tracked separately so the streaming change ships clean.

1. **logfire alert on absent worker spans.** `no run_track_upload spans in 5 min` would have paged at 19:01 UTC on 2026-05-06.
2. **postgres reaper for stuck `processing` jobs.** any job in `processing` for > N minutes gets failed (or re-enqueued) by a periodic task. this would have made the outage self-healing the moment the worker came back.
3. **fly worker restart policy.** change from `on-failure` (`max_retries=10`) to `always` (no limit). there's no scenario where giving up on a singleton worker helps.
4. **fly worker health check.** small TCP listener inside `backend.worker` so fly can detect a process that's running-but-stuck (the streaming fix doesn't address that class of failure).
5. **bigger picture: PDS uploadBlob byte-streaming has a known gap** — DPoP nonce mismatch on first attempt after long idle can exhaust an async iterator before the retry inside upstream `OAuthClient.make_authenticated_request`. the workaround in this PR is `_signed_streaming_post`, which reimplements just enough of the DPoP flow to call the body factory per attempt. the durable fix is upstreaming a body-factory parameter into `atproto_oauth.OAuthClient` itself.

## key takeaways

- **the upload pipeline holds long-form audio in RAM.** "the worker has 2 GB" is irrelevant when each in-flight upload buffers the file 3–5 times. memory bumps would only delay the same OOM.
- **`restart.policy = on-failure with max_retries`** is wrong for a singleton worker. fly should keep trying forever; the outage class we care about is "we need a human" and giving up after 10 tries is exactly that.
- **the gap between "the worker is dead" and "we know the worker is dead" was 4 days.** that's the most expensive number in this incident. an alert on "no worker spans in 5 min" closes it.
- **content-hashed staging files saved us from total loss.** even after 4 days, the lossless source bytes were still in R2 — for the 3 users whose OAuth sessions hadn't expired we recovered without their participation. for the 6 we couldn't, the cost was a re-upload, not lost art.

## related

- 2026-04-02 deploy-outage-oom-kill — separate OOM class (HTTP `app` machine, 1 GB → 2 GB). same lesson about cold-start memory pressure that we apparently failed to generalize.
- #1357 — the open issue tracking "in-memory upload pipeline." this PR partially addresses #1357 by removing the buffer points; the pipeline still spools to /tmp during transcode (necessary for ffmpeg input) but no longer holds bytes in process memory.
- #1359 — split worker into its own fly process group. that change protected the HTTP server from worker OOMs (correct), but did not prevent the worker itself from OOMing (this PR).

## references

- fly machine events: `fly machine status 6e8204deb36148 -a relay-api`
- logfire production traces 2026-05-06 18:56 – 19:32 UTC and 2026-05-10 19:02 – 19:15 UTC
- stranded jobs: `jobs` table where `type='upload' and status='processing' and created_at > '2026-05-06T18:56'` (manually marked failed at 19:08:26)
- worker entrypoint: `backend/src/backend/worker.py`
- restart policy: `backend/src/backend/_internal/background.py:docket_worker_lifespan`
