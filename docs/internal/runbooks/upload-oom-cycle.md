---
title: "upload pipeline OOM cycle"
---

## symptoms

- `api.plyr.fm` returning **502s** intermittently (fly proxy response when health check critical)
- album uploads failing at "100%" — upload completes, then post-upload step errors
- users report being **logged out** mid-session (frontend treats 502 on `/auth/me` as auth failure)
- fly status shows machines cycling: `exit_code=137, oom_killed=true`
- logfire shows bursts of `docket.ConcurrencyBlocked` and `slowapi.RateLimitExceeded`

## observed behavior (2026-04-30 incident)

reported by `flo.by` at ~12:54 UTC after uploading an album. backend was OOM-cycling for several hours before mitigation at 17:11 UTC.

| time (UTC) | event |
|---|---|
| 12:48 | first `docket.ConcurrencyBlocked` of the day |
| 12:54 | flo.by reports upload failures, 502s, logout |
| 13:00 | brief asyncpg `InterfaceError` + `PendingRollbackError` (DB hiccup) |
| 13:00–14:36 | **1,467** `slowapi.RateLimitExceeded` (upload retry storm) |
| 13:00–14:00 | traffic surge: 1.6k–2k req/hr (vs normal ~400) |
| 12:48–15:35 | **220** `docket.ConcurrencyBlocked` |
| 17:08:17 | `consume_jetstream` dispatches ~8 simultaneous `run_track_upload` tasks |
| 17:08:20 | `Out of memory: Killed process 650 (uvicorn)` total-vm 1.5GB, anon-rss 850MB |
| 17:08:21 | fly restarts machine, health check `gone` until uvicorn boots |
| ...      | OOM cycle repeats every ~5 min |
| 17:11 | `fly scale memory 2048 -a relay-api` — both machines recover to passing |

OOM kernel log:
```
[298.079808] Out of memory: Killed process 650 (uvicorn)
total-vm:1505420kB, anon-rss:849600kB, file-rss:40kB, shmem-rss:0kB
INFO Process appears to have been OOM killed!
```

## root cause

**three compounding structural issues:**

1. **upload pipeline holds full audio bytes in memory.** for each track, the worker holds:
   - the lossless source bytes (`backend/src/backend/api/tracks/uploads.py:378`, `_transcode_audio` does `source_data = await storage.get_file_data(...)`)
   - the transcoded bytes (`uploads.py:479`, kept on `TranscodeInfo.transcoded_data` for phase 4)
   - re-fetched playable bytes if no transcode (`uploads.py:613`, another `get_file_data`)

   `storage.get_file_data()` returns `bytes` — there is no streaming variant. for a 50MB FLAC + 10MB MP3 transcode, peak per task ≈ 60–150MB.

2. **HTTP server and docket worker share one process.** `fly.toml` has a single process group `app` running `uv run uvicorn backend.main:app`, with the docket Worker started in the same process via `backend/_internal/background.py:84`. When the upload tasks OOM the process, **uvicorn dies with them** — that's why HTTP traffic returned 502 and authenticated users got logged out (502 on `/auth/me` ≠ 401, but the frontend currently treats failures as session loss).

3. **concurrency caps are too loose for the memory footprint.** `worker_concurrency=10` (`config.py:830`), per-artist cap `ConcurrencyLimit("artist_did", max_concurrent=3)` (`uploads.py:1102`). 1GB VM was the original size — 10 concurrent in-memory file copies never had headroom.

## remediation

**immediate (done):**
```bash
fly scale memory 2048 -a relay-api
```
both machines back to passing. note: this only updates the live machines — `fly.toml` still says `memory = '1gb'`. needs to be persisted in the toml or next deploy reverts.

**structural (tracked):** see zzstoatzz/plyr.fm#1357

## verification after recurrence

```sql
-- confirm OOM cycle vs other failure mode
-- (OOM kills don't appear in logfire — check fly events for exit_code=137)
SELECT
  exception_type,
  COUNT(*) as count,
  MIN(start_timestamp) as first_seen,
  MAX(start_timestamp) as last_seen
FROM records
WHERE deployment_environment = 'production'
  AND is_exception = true
  AND start_timestamp > NOW() - INTERVAL '4 hours'
GROUP BY exception_type
ORDER BY count DESC
```

```bash
# check for OOM in fly events (the authoritative signal)
fly machine status <id> -a relay-api | grep -E "oom|exit_code"
```

a healthy state has both machines `1/1 passing`, no `oom_killed=true` in recent events, and no `RateLimitExceeded` storm.

## incident history

- **2026-04-30**: flo.by album upload triggered hours-long OOM cycling. mitigated by 1GB → 2GB memory bump. structural fixes tracked separately.

## related docs

- [connection pool exhaustion](/runbooks/connection-pool-exhaustion/) — different failure mode, also presents as 500s
- [logfire querying guide](/tools/logfire/)
