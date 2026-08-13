# plyr.fm Zig REST backend

This is the source-authoritative `/v1` app-view API. It is intentionally a
separate contract from the Python API: user-owned records remain authoritative,
Postgres is a rebuildable index, and R2 is a delivery mirror rather than a
second source of truth.

## local commands

Run commands from the repository root through the root justfile:

```sh
just zig check
just zig test-http
just zig test-postgres
just zig image
just zig smoke-canary
DATABASE_URL=... TRACK_COLLECTION_NSID=... LIST_COLLECTION_NSID=... PROFILE_COLLECTION_NSID=... LIKE_COLLECTION_NSID=... just zig reconcile-catalog
INDEX_MODE=disabled TRACK_COLLECTION_NSID=fm.plyr.dev.track LIST_COLLECTION_NSID=fm.plyr.dev.list PROFILE_COLLECTION_NSID=fm.plyr.dev.actor.profile LIKE_COLLECTION_NSID=fm.plyr.dev.like just zig run
just zig bench-http --duration 5 --concurrency 16
just zig bench-api-parity
DATABASE_URL=postgresql://... just zig bench-http --with-index --path '/v1/tracks?limit=50'
DATABASE_URL=postgresql://... TRACK_COLLECTION_NSID=fm.plyr.dev.track LIST_COLLECTION_NSID=fm.plyr.dev.list PROFILE_COLLECTION_NSID=fm.plyr.dev.actor.profile LIKE_COLLECTION_NSID=fm.plyr.dev.like just zig repair-repo did:plc:example
DATABASE_URL=postgresql://... TRACK_COLLECTION_NSID=fm.plyr.dev.track LIST_COLLECTION_NSID=fm.plyr.dev.list PROFILE_COLLECTION_NSID=fm.plyr.dev.actor.profile LIKE_COLLECTION_NSID=fm.plyr.dev.like just zig reconcile-accounts
just zig bench-snapshot
```

pg.zig uses system OpenSSL by default. On Apple Silicon with Homebrew's keg-only
OpenSSL, forward both paths explicitly when invoking `zig build`:

```console
zig build \
  -Dopenssl_include_path=/opt/homebrew/opt/openssl@3/include \
  -Dopenssl_lib_path=/opt/homebrew/opt/openssl@3/lib
```

The two options are a pair; supplying only one is a configuration error.

`check` includes a black-box HTTP contract smoke test on an ephemeral port.
`test-postgres` starts a Zig-only disposable Postgres 14 container,
waits for it to accept connections, creates minimal projection schemas, and
exercises the real `pg.zig` adapters. It covers atomic ordered-list replacement,
source-authoritative track replacement, replay and durable tombstone semantics,
whole-commit chain gap/conflict handling, and rollback across projection types.
It also covers authenticated complete-repo bootstrap, list and track absence
reconciliation, durable malformed-record quarantine and repair, and repair
replay before applying and reversing the real Alembic projection migrations.
Search coverage exercises the real ranked Postgres adapter, discovery policy,
literal wildcard handling, and the projection trigram-index migration.
It only destroys objects in the dedicated `zig_test` database on port 5435;
both test paths refuse any other database name. The HTTP benchmarks use a
third `zig_bench` database on port 5434, so neither path can overwrite the
Python suite's `relay_test` schema.

`bench-api-parity` is the representative cross-runtime gate. It allocates a
unique Compose project and random host ports, bootstraps a database named only
`plyr_bench`, seeds equivalent Python and Zig projections, verifies both
50-track pagination contracts, measures native RSS and CPU efficiency, and
removes the entire stack on exit. It never reads a developer database URL.

Local product data follows the same authority boundary as deployment. A PDS
record written through the API, or discovered by repository ingestion/repair,
is the fixture; Postgres is the disposable result. A local bootstrap command
must start the ingester and create authentic environment-namespaced records (or
repair known repositories), never insert rows that pretend to be source state.
Direct SQL is reserved for projection adapter tests and benchmark fixtures.

## API configuration

| variable | required | purpose |
|---|---:|---|
| `MODE` | yes | `api`, `ingester`, `repair`, `catalog_reconciler`, or separately supervised `account_reconciler` |
| `TRACK_COLLECTION_NSID` | yes | exact environment-aware track-record NSID |
| `LIST_COLLECTION_NSID` | yes | exact environment-aware list-record NSID used by albums and playlists |
| `PROFILE_COLLECTION_NSID` | yes | exact environment-aware authored profile-record NSID |
| `LIKE_COLLECTION_NSID` | yes | exact environment-aware authored like-record NSID |
| `DATABASE_URL` | in normal API mode | PostgreSQL projection; canonical Postgres URLs and the existing SQLAlchemy `psycopg`, `psycopg2`, and `asyncpg` driver-qualified forms are accepted; missing or unknown configuration fails startup |
| `DATABASE_ROLE` | no | expected effective PostgreSQL role; startup opens the pool and fails closed if `current_user` differs |
| `DATABASE_POOL_SIZE` | no | bounded PostgreSQL connection pool size, default `8` |
| `INDEX_MODE` | no | `required` by default; `disabled` is an explicit test/development mode whose readiness is `503` |
| `MAX_CONNECTIONS` | no | hard cap on accepted connection handlers, default `128` |
| `PORT` | no | listener port, default `8001` |
| `CORS_ALLOWED_ORIGINS` | no | comma-separated exact browser origins; empty disables CORS |
| `ZIG_OAUTH_CLIENT_ID` | as an all-or-nothing auth set | HTTPS metadata-document URL; canary value is `https://api.next.plyr.fm/oauth-client-metadata.json` |
| `ZIG_OAUTH_REDIRECT_URI` | as an all-or-nothing auth set | exact callback URL on the same API origin |
| `ZIG_OAUTH_FRONTEND_ORIGIN` | as an all-or-nothing auth set | exact frontend origin used for post-callback redirects and authorization of browser credential mutations |
| `ZIG_OAUTH_SCOPE` | as an all-or-nothing auth set | ATProto OAuth scope containing `atproto` |
| `ZIG_OAUTH_CLIENT_PRIVATE_KEY` | as an all-or-nothing auth set | standard-base64 raw 32-byte P-256 confidential-client key |
| `ZIG_AUTH_ENCRYPTION_KEY` | as an all-or-nothing auth set | standard-base64 raw 32-byte XChaCha20-Poly1305 key; must differ from the OAuth client key |
| `AUTH_START_CLIENT_LIMIT` | no | per-client OAuth-start admissions per fixed window, default `10` |
| `AUTH_START_SUBJECT_LIMIT` | no | per-normalized-handle OAuth-start admissions per fixed window, default `10` |
| `AUTH_START_GLOBAL_LIMIT` | no | process-fleet OAuth-start circuit breaker per fixed window, default `120` |
| `AUTH_START_WINDOW_SECONDS` | no | OAuth-start fixed-window duration, default `60` |
| `AUTH_TRUSTED_PROXY_CIDRS` | no | comma-separated reverse-proxy ranges allowed to supply `CF-Connecting-IP`; empty trusts only Fly's observed peer |
| `INGEST_REPAIR_DID` | in repair mode | canonical DID whose complete repository is fetched, verified, and atomically reconciled |
| `ACCOUNT_CHECK_INTERVAL_SECONDS` | no | authoritative current-PDS recheck interval, default 21600 (six hours) |
| `ACCOUNT_CHECK_RETRY_SECONDS` | no | retry interval after transport or non-authoritative status, default 300 |
| `ACCOUNT_CHECK_LEASE_SECONDS` | no | expired-worker claim recovery window, default 120 |
| `ACCOUNT_CHECK_SEED_SECONDS` | no | periodic sweep from authenticated repository heads, default 300 |
| `ACCOUNT_CHECK_IDLE_MILLISECONDS` | no | idle claim-poll interval, default 1000 |

`/health` is process liveness. `/ready` is product readiness and requires a
configured track index. The listener acquires a connection permit before
`accept`, so saturation applies kernel-backlog backpressure instead of creating
unbounded detached threads.

The browser-authentication compatibility surface is `GET /auth/start`,
`GET /auth/callback`, `POST /auth/exchange`, `GET /auth/me`,
`POST /auth/logout`, `GET /auth/pds-options`, and
`GET /oauth-client-metadata.json`. OAuth ceremony terminates on
`api.next.plyr.fm`; the existing frontend receives only a one-minute,
single-use exchange capability in a URL fragment that is never sent to the
frontend server, then uses the `__Host-plyr_session` API cookie. Its browser-
enforced prefix forbids a `Domain` attribute and requires root path plus TLS.
Cookie-setting and cookie-mutating endpoints reject requests without the exact
configured frontend `Origin`; CORS response headers alone are not treated as
CSRF protection, and successful credential responses are explicitly `no-store`.
Identity/session reads project only DID, handle, and scope;
they never retrieve the sealed OAuth credentials. A future PDS-write slice must
request that separate capability explicitly.

`GET /auth/start` is the one authentication request that deliberately depends
on Redis: it can trigger handle and DID resolution, several independently
validated metadata fetches, and PAR. A Lua command atomically increments the
hashed client, normalized-handle, and global buckets and establishes their
expiry across all API instances. Defaults are 10 starts per client, 10 per
handle, and a 120-start fleet circuit breaker each minute. Fly's observed peer is authoritative unless
it belongs to an explicitly configured trusted reverse-proxy range; only then
may `CF-Connecting-IP` identify the original client. A direct caller cannot
select that branch by forging headers, and the API never trusts
`X-Forwarded-For`. Requests with no Fly identity share a conservative anonymous
bucket. The handle and global limits bound outbound work even if a reverse-
proxy client identity is untrustworthy or intentionally varied.
Redis is probed when the auth limiter is configured, broken connections are
discarded for a later reconnect, and limiter failure returns `503` only from
the expensive start path. A missing limiter likewise keeps login starts closed
without affecting metadata, existing sessions, or public reads.

The current product surface is `GET /v1/tracks`,
`GET /v1/tracks/{track_id}`, `GET /v1/tracks/{track_id}/playback`,
`GET /v1/tracks/{track_id}/likes`,
`PUT` and `DELETE /v1/tracks/{track_id}/like`,
`GET /v1/me/likes`, `POST /v1/me/likes/resolve`,
`GET /v1/artists/{identifier}`, `GET /v1/artists/{identifier}/metrics`,
`GET /v1/charts/tracks`, and the collection and detail forms of `GET /v1/albums`
and `GET /v1/playlists`, plus `GET /v1/search`. Search accepts
one strict query, a bounded global limit, and an optional type set; it returns
verified record references with match class and provenance but no unstable
numeric score. The track collection accepts a strict
`limit` from 1 to 100 and an opaque `cursor`; it
accepts an optional canonical `artist_did`, applies discovery or artist-view
policy before keyset pagination, and returns the same track representation as
detail. Track reads require an authenticated record and authoritative account
availability, then compose separately attributed authored profile, application
policy, metrics, and unverified R2 delivery fields. One canonical-URI policy
row carries access and operator-moderation claims with independent provenance;
the Python write paths maintain access while labeler reconciliation owns
moderation, and neither can overwrite the other. The migration imports existing
decisions once. A separate canonical-URI metrics rollup owns play counts and
mirrors them back to the Python column only for compatibility. Verified PDS
blob mirrors live in a separate,
record-CID-bound delivery projection. A legacy track row is optional enrichment:
a verified PDS record without one remains readable with a derived-public default
rather than inheriting local publish state. Playback is a separate capability:
it prefers an exact record-CID-bound verified delivery origin, otherwise exposes
a safe author-declared HTTPS URL with explicitly unverified integrity, and
represents missing delivery without hiding the catalog record. Anonymous gates
return `authentication_required`; private and moderated records remain hidden.
Artist lookup requires a verified, non-deleted profile record plus affirmative
account availability, accepts a canonical DID or a case-insensitive handle
alias, and exposes the transitional source of each field. Authored bio, avatar,
and timestamps come from the repository projection; legacy presentation and
preference fields cannot admit a resource. Album collection and detail both
read the same authenticated list projection. Collection summaries contain only
verified record metadata, verified ordered-membership counts, attributed owner
profiles, and derived metrics; detail preserves every strong-reference position
and hydrates only an exact public URI/CID match.

The track chart is likewise an explicitly derived resource. It ranks admitted
verified tracks by distinct, currently available liker DIDs for all time or an
exact 30-, 7-, or 1-day authored-record window. Duplicate records from one DID
cannot manufacture extra votes, unavailable accounts do not rank content, and
the response keeps the period count separate from the all-time count. The
ranking hydrates through the same discovery policy and track representation as
the catalogue; neither a legacy like row nor a numeric track ID is authority.

Track liker reads expose the underlying verified interaction records rather
than treating the database as social authority. They require the current
track's exact URI and CID, filter unavailable actor repositories, and paginate
with a cursor bound to that strong-reference scope. Stale likes against an
earlier record revision neither appear in the list nor contribute to charts.
Track representations derive a distinct-actor `metrics.like_count` through the
same boundary and the configured like NSID, so next's existing count and liker
UI do not consult legacy interaction rows or an adjacent environment's records.
See [`zig-v1-track-likes.md`](../docs/internal/architecture/zig-v1-track-likes.md).

Artist metrics are a separate public capability rather than extra fields on the
artist identity resource. They resolve a handle alias through the verified
artist boundary, then aggregate admitted verified track records and canonical-
URI application play metrics. They never read legacy numeric track IDs or the
legacy play-count column. Track rank is exposed only through the independently
derived chart resource.

Playlist collection and detail read only authenticated `playlist` list records;
they do not join the Python playlist table or fetch a mutable PDS record during
the request. The collection supports global discovery or an optional canonical
`owner_did`, with cursors cryptographically opaque and bound to that exact query
scope. Detail preserves the signed order and strong references, reuses the same
composed-track decoder as standalone reads, and marks missing, stale-CID,
private, moderated, or unavailable members uniformly unavailable. Private
app-local playlists remain intentionally absent until session-aware private
storage is designed.

`MODE=repair` is not part of the API service. It resolves the DID's PDS,
rejects unsafe or mixed DNS destinations, pins a checked address for TLS,
verifies the complete signed repository, reconciles `plyr_index`, and exits.
It never runs migrations; use a write-capable projection role distinct from
the narrowly scoped canary API credential.

`MODE=account_reconciler` is also independent of the API and firehose roles.
It leases due DIDs from Postgres, resolves each DID's current PDS, and persists
only authoritative account evidence. Relay account frames merely make an
existing authenticated repository due sooner. A periodic sweep is the
correctness backstop, and transport/infrastructure failures schedule retries
without hiding content. Multiple reconcilers coordinate with `SKIP LOCKED` and
expired leases; an untrusted PDS never blocks signed firehose progress.

Do not source or copy the root `.env` into a worktree. Point a command at the
existing environment through the normal settings mechanism, and never print
secret values while checking configuration.

## canary deployment

Browser authentication is non-rebuildable application state, not an index.
The successor therefore owns a separate `plyr_auth` schema. Browser sessions
and one-time exchange values are random 256-bit bearer tokens; OAuth state is
a standards-conventional random 128-bit value. Postgres receives only SHA-256
lookup digests for all three. PKCE verifiers, OAuth
access/refresh tokens, DPoP private keys, and the temporarily recoverable
session value are stored only in versioned XChaCha20-Poly1305 envelopes whose
associated data binds each ciphertext to its purpose. Redis is not in the
credential path. Exchange uses atomic `DELETE ... RETURNING`, sessions are
revocable and expire locally, and the `__Host-plyr_session` cookie is host-only
to `api.next.plyr.fm` with `HttpOnly; Secure; SameSite=Lax`.

OAuth state is also bound to the browser that initiated the login with a
separate, host-only `__Host-plyr_oauth` HttpOnly cookie. The callback checks the
cookie before consuming server-side state and clears it on completion, which
prevents forwarding a completed callback into another browser to swap that
browser into the attacker's session.

Zat owns OAuth metadata, PKCE, PAR, client assertions, token exchange, refresh,
and DPoP ceremony. The application binds handle resolution in both directions,
requires the DID document id and PDS service type, validates callback issuer
and token subject exactly, consumes state before exchange, and publishes the
session and one-time exchange token in one transaction. It owns destination
safety as well as storage: every PDS, authorization-server metadata origin,
and independently declared authorization, PAR, and token endpoint must resolve
entirely to global addresses. Each server-side request pins its endpoint's
checked address while preserving its own TLS identity; valid cross-origin OAuth
endpoints do not require a global Zat behavior change. Zat v0.3.28 provides the
pinned-destination transport, optional DPoP nonce handling, and expanded
special-purpose address rejection used by this boundary.

`fly.canary.toml` defines an API-only Fly service named
`plyr-api-zig-canary`. It uses one 256 MiB shared-CPU machine, scales to zero,
and has no worker, jetstream, runtime-migration, Docket queue, R2, PDS-write, or
production traffic responsibilities. `DATABASE_URL` points at the
isolated `next-zig-backend` Neon branch through Neon's direct endpoint and the
`plyr_zig_canary` database role. `DOCKET_URL` points only at the dedicated
`plyr-redis-next` instance for ephemeral play deduplication. The application owns a bounded connection pool;
the Neon transaction-pooler endpoint is incompatible with pg.zig's two-cycle
unnamed extended-protocol statements and must not be used. Migrations grant
that role schema usage and reads on current and future projection tables. During
the compatibility phase it also reads `tracks`, `artists`, `albums`, and
`user_preferences` in the isolated clone. Its only writes are atomic
canonical-URI play metrics, the temporary legacy count mirror, and optional
share attribution; the migration test proves the column/table/sequence grant
set and rejects broader authority.

The already-registered `deploy staging` GitHub workflow exposes an explicit manual
`zig-canary` target. Local development may build and run the image, but deployment
goes through that target. Keeping it in a workflow already present on the default
branch lets this long-lived PR deploy its own ref before merge; a newly added
standalone workflow cannot be dispatched until it reaches the default branch.
The job first verifies the dedicated Fly app has its database, Redis, OAuth
client-key, and auth-encryption secret names configured, without reading secret
values. It builds and publishes one commit-addressed image, then applies Alembic
`head` to only the isolated next Neon branch with the writer credential before
deployment. The runtime credential never receives migration authority. On the
first run, its explicit `reconcile_catalog` input launches that image as an
unmanaged `--rm` Machine in the canary app with a dedicated next-branch writer
credential: it authenticates current production-namespace repositories, writes
only the projection, and is destroyed on exit. The API service receives only its
least-privilege runtime credential.
Later deployments leave reconciliation disabled unless source state needs a
deliberate refresh. The Fly hostname is the initial infrastructure verification
surface. The job runs
`scripts/canary_smoke.py` after deployment and fails unless readiness, API
discovery, track collection/detail, anonymous playback, artist lookup, album
collection/detail, verified playlist collection/detail, a real track search,
and a sustained play followed by a Redis-rejected duplicate all prove their
expected semantics and request-ID contract.
The gate requires a real verified track with an available HTTPS playback
capability, round-trips its collection representation through detail, and
resolves its artist; an empty or wholly unavailable projection cannot pass. Run
the same check with `just zig smoke-canary`.

The same manual job then measures—not estimates—the deployed process. A tiny
read-only helper in the image locates the actual Zig executable through `/proc`
and records its current/peak RSS and CPU ticks alongside cgroup current/peak
memory. The runner benchmarks the real 50-track product read for ten seconds at
concurrency 1 and 16, retaining request rate and p50/p95/p99 latency. A combined,
commit-addressed artifact and workflow summary are produced even when a gate
fails. Deployment fails above 16 MiB idle application RSS, above 64 MiB peak
application RSS, after a Zig process restart, or on any Zig load-test HTTP error.
The deployment job touches only the isolated next environment; it does not load,
SSH into, or configure the existing Python staging or production applications. This
instrumentation exists only in the explicitly dispatched
canary job; ordinary PR checks do not run remote load or deployment measurements.
Run the same HTTP load driver against an already deployed target with
`just zig bench-canary -- ...`.

The deployed `a922f59f` checkpoint passes the complete smoke gate in `iad`,
including verified search, a real canonical play-metric increment through the
isolated Neon role, and Redis duplicate suppression. Its retained 50-track
evidence reports 9,812 KiB idle RSS, 15,412 KiB peak RSS, 0.51 application
CPU-seconds across 22.36 seconds, and zero load-test errors. The same product
contract currently passes through the deployed frontend's narrow Pages transport;
the authentication slice moves the client boundary to `api.next.plyr.fm` before
`just zig smoke-next` targets that hostname. Infrastructure health remains direct-Fly only. See
`docs/internal/architecture/zig-canary.md` for the exact throughput, latency,
and workflow artifact.

The iteration loop is native by default. `just zig check` uses the host Zig
toolchain and `just zig image-check` builds and starts a host-architecture Linux
container, proves `/health`, and exercises the same `/proc` snapshot helper used
on Fly. It never requests amd64 emulation on an arm64 development machine. When
an amd64 image sanity check is useful before deployment, manually dispatch
`validate docker build` with `target=zig-canary`; that registered workflow runs
one cached Zig image job on a native Linux/amd64 runner. Superseded PR checks are
cancelled. Cross-architecture assurance belongs on the matching runner, while
the deployment workflow remains the authoritative Fly image build.

`next.plyr.fm` is the public parallel deployment of the successor application,
not a percentage canary. It always means a frontend backed by the Zig `/v1`
surface. The initial A/AAAA records exposing the bare Fly service were a
temporary backend-verification state, not the completed next application. The
dedicated `plyr-fm-next` Pages project claims the hostname only after the
existing Svelte frontend's `zig-v1` client boundary passes locally and on the
Pages deployment. The successor API lives at `api.next.plyr.fm`, mirroring the
production frontend/API hostname split while remaining same-site. It evolves beside
`plyr.fm` without changing the existing production or staging applications.
`next.plyr.fm` has one proxied CNAME to that project and does not expose the Fly
API as a website.

Before the first useful canary deployment, select the workflow's
`reconcile_catalog` input to seed the new projection from current authenticated
repositories. Existing canonical-looking track and album rows in the isolated
production clone supply candidate DIDs only; none of their metadata, CIDs, PDS
locations, or account state is
trusted. The one-shot role verifies each complete repository through the same
signature/MST/CID path as continuous ingestion and fails if no repository verifies
or any candidate repository is retryable or rejected. An authenticated repository
can still succeed when individual selected records are malformed: those records
are atomically quarantined with their CID, reason, and commit proof while valid
siblings project normally. Local `just zig reconcile-catalog` remains a development
command; remote reconciliation uses the disposable Fly Machine and a dedicated
next-branch writer credential that cannot mutate legacy tables.
