---
title: "Zig HTTP foundation benchmark"
---

## purpose

This is a reproducible local baseline for the first Zig HTTP boundary. It is
not a production capacity claim: it excludes TLS, network latency, Postgres,
and response bodies from real indexed tracks. Its purpose is to catch large
regressions in routing, request allocation, identifier parsing, and response
serialization while the server foundation changes.

## method

Run from the repository root:

```sh
just zig bench-http --duration 3 --concurrency 8
```

The recipe builds `ReleaseFast`, starts an isolated API process on an ephemeral
localhost port with `INDEX_MODE=disabled`, opens one persistent HTTP connection
per Python worker, and reports completed requests plus p50/p95/p99 latency. Use
`--path` and `--expect-status` to measure non-200 contracts.

The black-box HTTP test separately starts the server with `MAX_CONNECTIONS=2`,
occupies both handlers with incomplete requests, and proves a third request is
queued until a permit is released. This tests the bound itself; the throughput
benchmark stays below the configured connection capacity.

## baseline — 2026-08-08

Machine: Apple M5 Pro, 64 GiB, macOS Darwin 25.5.0. Toolchain: Zig 0.16.0,
Python 3.14.4.

`GET /health`:

| concurrency | requests/sec | p50 | p95 | p99 | unexpected responses |
|---:|---:|---:|---:|---:|---:|
| 1 | 17,864 | 0.055 ms | 0.067 ms | 0.080 ms | 0 |
| 8 | 19,021 | 0.365 ms | 0.884 ms | 1.200 ms | 0 |
| 32 | 19,226 | 1.405 ms | 3.570 ms | 4.857 ms | 0 |

The complete track route with a valid encoded AT-URI, identifier decoding,
request-arena allocation, absent-index classification, and `503` JSON envelope:

| concurrency | requests/sec | p50 | p95 | p99 | unexpected responses |
|---:|---:|---:|---:|---:|---:|
| 8 | 19,160 | 0.359 ms | 0.881 ms | 1.196 ms | 0 |

The similar saturation point for health and the larger route suggests this run
is dominated by the localhost/Python load generator rather than application
routing. Future comparisons must use the same harness and machine, and should
add a database-backed benchmark before optimizing the PostgreSQL adapter.

## authenticated identity baseline — 2026-08-10

`GET /auth/me` exercises the browser-session boundary through a real HTTP
connection, hashes the opaque `__Host-plyr_session` cookie, performs the narrow
Postgres identity projection, and serializes the authenticated principal. The
fixture uses the disposable Postgres instance created by `just zig
test-postgres`; it does not contain production credentials or data.

The benchmark reads the complete Cookie header from an environment variable so
the credential is absent from the command line and result JSON:

```sh
PLYR_BENCH_COOKIE='__Host-plyr_session=<disposable token>' \
  just zig bench-http --with-index --path /auth/me --expect-status 200 \
  --cookie-env PLYR_BENCH_COOKIE --duration 5 --concurrency 1
```

Native `ReleaseFast` results on the same Apple M5 Pro:

| concurrency | requests/sec | p50 | p95 | p99 | RSS after load | errors |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 5,443.3 | 0.178 ms | 0.221 ms | 0.308 ms | 3.36 MiB | 0 |
| 16 | 15,755.9 | 0.936 ms | 1.824 ms | 2.354 ms | 4.17 MiB | 0 |

This is a reproducible Zig regression baseline, not yet a Python efficiency
comparison. The Python backend must be exercised through its corresponding
authenticated identity route with the same database locality, payload, load
generator, and session semantics before calculating a relative multiplier.

## Python comparison and resource budget — 2026-08-08

This comparison uses `oha 1.15.0` against native localhost processes on the
same Apple M5 Pro. The Python process is the complete FastAPI application under
Uvicorn with its normal import graph and startup hooks. `RELAY_TEST_MODE=1`
isolates external behavior, `RATE_LIMIT_ENABLED=false` prevents the global
100/minute policy from turning the benchmark into a 429 benchmark, and access
logging is disabled for both sides. The Zig process is a `ReleaseFast` build
with its index explicitly disabled. Both serve a small JSON health response;
this is a runtime-boundary comparison, not evidence of track-route parity.

| concurrency | implementation | requests/sec | p50 | p99 | RSS after load |
|---:|---|---:|---:|---:|---:|
| 1 | Zig | 24,055 | 0.039 ms | 0.086 ms | 3.28 MiB |
| 1 | Python | 3,139 | 0.300 ms | 0.626 ms | 466.1 MiB |
| 32 | Zig | 111,196 | 0.284 ms | 0.369 ms | 3.28 MiB |
| 32 | Python | 6,298 | 4.690 ms | 7.178 ms | 466.1 MiB |

At concurrency one, the server CPU-time deltas were 1.77 seconds for 120,321
Zig responses and 3.20 seconds for 15,698 Python responses. That is about
67,978 versus 4,906 responses per CPU-second, a **13.9× CPU-efficiency gain**.
Wall-clock throughput is 7.7× higher at one connection and 17.7× higher at 32.
Loaded native RSS is **142× smaller**.

The Linux measurements provide a production-shaped memory comparison:

- the live staging Uvicorn process reported 453.5 MiB RSS and a 454.1 MiB
  high-water mark from `/proc`;
- the final amd64 Zig container idled at 7.05 MiB working set, a 64.4×
  application-process reduction;
- a five-second, 32-connection container run peaked at 25.2 MiB of total
  cgroup memory and settled to a 16.7 MiB working set;
- that run sustained 50,857 requests/sec while executing through amd64
  emulation on the arm64 development machine, so it is a packaging/load memory
  check rather than a native Linux CPU result;
- the executable is 4,507,320 bytes and the Debian/CA/OpenSSL runtime image is
  33,077,196 bytes.

These numbers establish the first resource gate, not a permanent victory. A
database-backed track benchmark and Fly-native CPU/memory measurements are
required before routing canary traffic. Every added subsystem must keep the
service within a 256 MiB machine rather than spending the current headroom by
default.

## equivalent database-backed catalogue comparison — 2026-08-10

`just zig bench-api-parity` replaces the health-only comparison with useful
application work. It creates a uniquely named, disposable Compose project on
random host ports; bootstraps the complete Python, Zig projection, and Zig auth
schemas; and seeds one Postgres database with 100 equivalent public tracks for
both read models. Before measuring, semantic probes require the Python
`GET /tracks/?limit=50` and Zig `GET /v1/tracks?limit=50` resources to each
return 50 tracks, `has_more: true`, and a successful status. The command tears
down Postgres and Redis even when a build, probe, or benchmark fails.

Both native processes use a 16-connection local Postgres pool, no access log,
the same persistent-connection Python load generator, and a five-second pass
at each concurrency. The Python process is the complete FastAPI application;
the Zig process is `ReleaseFast`. Their representations deliberately are not
byte-identical: Python returned 56,578 bytes and Zig returned 100,548 bytes per
page. The Zig result therefore includes 1.78 times as much response-body work,
rather than gaining throughput by returning less data.

| concurrency | implementation | responses/s | p50 | p95 | p99 | RSS | responses/CPU-s | errors |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | Python | 99.7 | 9.706 ms | 10.867 ms | 12.312 ms | 475.6 MiB | 113.7 | 0 |
| 1 | Zig | 317.1 | 3.121 ms | 3.375 ms | 3.629 ms | 3.70 MiB | 3,965.0 | 0 |
| 16 | Python | 107.6 | 140.514 ms | 229.728 ms | 241.131 ms | 512.2 MiB | 108.5 | 0 |
| 16 | Zig | 2,579.4 | 5.510 ms | 9.495 ms | 11.567 ms | 5.34 MiB | 3,699.4 | 0 |

At concurrency one, Zig delivered **3.18×** the throughput, used **128.44×**
less RSS, and completed **34.87×** as many responses per CPU-second. At
concurrency 16, it delivered **23.97×** the throughput, used **95.84×** less
RSS, and retained a **34.10×** CPU-efficiency advantage. This is the first
apples-to-apples database-backed evidence for the rewrite's resource premise.
It remains a localhost regression baseline, not a Neon latency or deployed
capacity claim; the canary workflow keeps the independent Fly-native resource
gate.

## database-backed artist baseline — 2026-08-08

The first artist slice was measured against the disposable Postgres 14
projection used by `just zig test-postgres`. Each response includes the complete
artist JSON representation and performs a pooled database query. These numbers
are a local regression baseline; the database is on localhost and the fixture
is deliberately small, so they are not a Neon or production capacity claim.

| identifier | concurrency | requests/sec | p50 | p95 | p99 | unexpected responses |
|---|---:|---:|---:|---:|---:|---:|
| DID | 1 | 4,742 | 0.204 ms | 0.252 ms | 0.361 ms | 0 |
| DID | 16 | 12,995 | 1.098 ms | 2.393 ms | 3.362 ms | 0 |
| mixed-case handle | 16 | 12,920 | 1.111 ms | 2.351 ms | 3.283 ms | 0 |

The handle path validates and normalizes the alias before querying and detects
case-insensitive ambiguity. Its result staying within one percent of DID lookup
shows that compatibility does not introduce a distinct application bottleneck
in this fixture. After the verified repair runtime was linked, the amd64 canary
image was 34,864,321 bytes, 1,626,322 bytes larger than the album-detail image.
Linking the exercised continuous firehose role produces a 35,152,308-byte
image, a further 287,987 compressed bytes. Its uncompressed ReleaseSafe
executable is 12,531,312 bytes because the firehose/WebSocket paths are no
longer dead code. The API, repair, and ingester roles share that artifact, but
only the selected role initializes its network or write-capable dependencies.

The artist-filtered track collection, returning five complete track resources,
recorded 2,770.5 responses/s at concurrency one (0.906 ms p99) and 9,318.0 at
concurrency 16 (4.934 ms p99), with zero unexpected responses. The request used
a percent-encoded DID and therefore exercises strict query decoding, artist
scope, content-view policy, SQL pagination, and serialization together.

The artist album collection, returning two canonical list-record summaries,
recorded 2,769.6 responses/s at concurrency one (0.596 ms p99) and 8,838.9 at
concurrency 16 (4.799 ms p99), with zero unexpected responses. This path adds
pooled aggregate SQL plus strict record URI and DAG-CBOR CID validation.

The verified album-detail route has its own guarded, reproducible fixture via
`just zig bench-album-detail`. It returns 20 ordered strong references and 20
complete composed-track resources from one query while validating every URI and
CID. The common verified-list adapter recorded 341.9 responses/s at concurrency
one (5.690 ms p99) and 1,905.9 at concurrency 16 (21.020 ms p99), with zero
unexpected responses and 3,440–6,320 KiB RSS. This supersedes the simplified
album-only adapter measurement, which did not share standalone track policy.

`just zig bench-playlists` exercises the same adapter for global collection and
detail. The one-summary collection recorded 264.9 responses/s at concurrency
one and 2,595.4 at concurrency 16; the 20-track detail recorded 287.7 and
3,042.1 responses/s respectively. All four scenarios completed without errors
and held the Zig process between 3,504 and 6,400 KiB RSS.
