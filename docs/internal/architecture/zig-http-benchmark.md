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
complete hydrated tracks from one query while validating every URI and CID.
It recorded 1,867.3 responses/s at concurrency one (0.894 ms p99) and 6,961.2
at concurrency 16 (5.907 ms p99), with zero unexpected responses.
