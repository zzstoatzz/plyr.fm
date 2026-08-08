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
