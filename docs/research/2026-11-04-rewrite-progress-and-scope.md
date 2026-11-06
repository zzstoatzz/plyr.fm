# Next rewrite progress and scope

**Date** November 4, 2026

**Code checkpoint** `4487b55d4` on main, through #2360

**Purpose** Record the architectural changes, implemented foundations, remaining ports, and decisions required before continuing.

This is a source and Git-history audit against the existing Python/Svelte app. Earlier PRs contain browser and service verification; this audit did not repeat those acceptance tests or recheck live reconciliation coverage. “Implemented” below means an implementation is present at this checkpoint. It does not mean production parity or cutover readiness.

## November 6 check-in

The tables below preserve the November 4 checkpoint; they are not a live status
matrix. Since then, Cycle 1 wired qualified listened-time accounting into the
player, radio and Jam output, with a retryable receipt outbox. Historical total
migration and personal listening history are still separate decisions. See
[play accounting](../internal/architecture/next-play-accounting.md).

The Spaces-backed real-time Jam MVP is now live and verified: shared explicit
commands, host-only seeking, cross-instance Redis coordination, fresh admission
on reconnect and real machine-failure recovery. See its
[completion audit](2026-11-06-jams-live-verification.md) for measured behavior and
limits, including one Redis primary, bounded membership freshness and deferred
one-speaker/native acceptance. This replaces the polling-room description below.

Discovery now has tag filters and chart period cycling, the queue has drag
reordering, and the shared player supports keyboard shortcuts and swipe
navigation/dismissal. For You, semantic discovery, persistence/backgrounding,
complete publishing/collection flows and the other recorded parity gaps remain
work to verify and complete; a visual mockup is not implementation. UI material
and layout studies are tracked in [#2431](https://github.com/zzstoatzz/plyr.fm/issues/2431).

The new Stats slice establishes four explained public-catalog totals: tracks,
artists, duration and Next-qualified plays. It excludes private/unlisted/removed
records and does not import production play totals. Add metrics with explicit
sources/definitions as the rewrite progresses rather than filling the page with
unverified parity counts. SDK/MCP, legacy-URL work and cutover rehearsal remain
deferred per the user's revised scope.

## Direction

The rewrite changes ownership and application boundaries as well as languages and frameworks.

| Concern | Chosen direction | Current boundary |
|---|---|---|
| Canonical music data | Users own signed PDS records and media references | Clients write records directly; the appview projects independently verified state. Public records remain the real `fm.plyr.*` records. |
| Appview | A read-only catalog and query service | Zig serves `/v1`; it does not hold user OAuth sessions or mutate users' repositories. “Read-only” still permits application-owned play accounting and POST-based reads. |
| Index and delivery | Postgres is a derived index; R2 is a delivery mirror | Ingestion/projection writes remain necessary. Historical play totals and moderation decisions need their own retention/migration rules. |
| Login | The user agent owns OAuth | Browser/native OAuth clients authorize PDS operations. Production login copy and return-intent behavior are product requirements worth preserving. |
| Client | Expo / React Native for web, iOS, and Android | Web is deployed. Native bundle exports are not equivalent to native release acceptance. The temporary Svelte client was removed in #2331. |
| Preferences | Owner-only personal Space | Appearance/playback settings sync through a dedicated staging Space type; volume remains local. The client currently supports a device-only fallback. |
| Jams | A room whose creator owns the underlying member Space | “Jam” and “room” are user-facing concepts. Guests own their own command records in the fuller protocol design. Ownership transfer is explicitly later. |
| Cutover | API, in-repo SDK, MCP, and UI move together | SDK and MCP are still planned. Everything new remains under `next/` until cutover. |
| Storage exploration | Postgres remains the current index | The ZKV/R2 spike in #2318 establishes feasibility, not an adopted migration or a cutover gate. |

Sources include [the read-only boundary in #2281](https://github.com/zzstoatzz/plyr.fm/pull/2281), [removal of Python-table reads in #2288](https://github.com/zzstoatzz/plyr.fm/pull/2288), [shared records in #2299](https://github.com/zzstoatzz/plyr.fm/pull/2299), [preferences in #2330](https://github.com/zzstoatzz/plyr.fm/pull/2330), and [the coordinated cutover direction in #2315](https://github.com/zzstoatzz/plyr.fm/issues/2315). The local-metrics exception is explicit in [the metric adapter](../../next/backend/src/internal/metrics/postgres_play_metric_store.zig#L1).

### Coexistence and dependencies

Next owns its deployment and database boundary, but public writes are shared user data. Editing a track from Next can change what production displays. CID compare-and-swap and preservation of unknown record fields matter; rolling back a Next deployment does not undo accepted PDS writes. See [the mutation implementation](../../next/app/src/pds.ts#L185).

Next also still consumes production services.

- Login previews and the account-provider catalog come from the [production auth read API](../../next/app/app/login.tsx#L8). Next performs its own OAuth afterward.
- Numeric track embed IDs, older playlist IDs, and album handle/slug URLs resolve through [production compatibility reads](../../next/app/src/CatalogEmbed.tsx#L19).
- Next Radio uses [the existing station hosts](../../next/app/src/radio.ts#L1). Their adapter reads production radio state and redirects audio to production delivery. See [the adapter contract](../../services/radio/README.md#L25).
- Operator labels come from the existing labeler. Existing Rust/Modal services are candidates for reuse through explicit contracts.

These dependencies need a retained owner or replacement before retiring the legacy backend. Keeping a working service can be the port disposition; every service does not need a language rewrite.

## Progress and process

| Arc | Result and lesson |
|---|---|
| Source ownership and `/v1`, #2281/#2288/#2299 | Canonical writes moved to clients and runtime reads stopped depending on Python's tables. Infrastructure isolation and user-data isolation are different boundaries. |
| Live ingestion, #2292 → #2312 | Upstream verification was temporarily trusted, then replaced with independent PDS proofs. Current live events are discovery hints. The old “trusts upstream” header in `stream_runner.zig` is stale; [the actual handler verifies touched records](../../next/backend/src/internal/ingest/stream_runner.zig#L158). |
| Repair/replay, #2323/#2329/#2324/#2325/#2328 | A verified snapshot still needs completeness, ordering, and transaction guarantees. Sparse repair proves selected collection ranges before deleting missing rows; repository locking protects newer live state and newer rejection evidence. See [collection proofs](../../next/backend/docs/collection-proofs.md#L3). |
| Fuzzing and migration #2314 | Migration 0029 exhausted locks; 0030 changed the counting mechanism before deployment. The old migration hold is resolved. Local performance results remain local measurements, rather than production SLOs. See [performance notes](../../next/backend/docs/perf.md#L29). |
| Spaces, #2330/#2335/#2338 | Private preferences and creator-owned room snapshots established real PDS/OAuth paths. The running Jam room is narrower than the command/recovery reducer in the service probe. |
| React Native, #2331–#2342 | Replacing the UI exposed lost product behavior in playback, queue, artwork, editors, and navigation. Framework replacement did not preserve that work automatically. |
| Radio/auth/embeds, #2343–#2360 | Product review caught integration and layout problems that successful builds missed. Playback needed a shared persistent player, server-derived radio position, real retry checks, original account copy, actual iframe size tests, and document-level Safari theming. |

The reference for a port should be production behavior and its incident/history arc, followed by the corresponding failure cases in the new architecture. A screen rendering, a bundle compiling, a reducer passing, or a PDS write succeeding each proves a different boundary.

The saved/indexed distinction remains important. An accepted PDS write can be pending or rejected by the index. Recovery must retain its URI/CID and avoid repeating a canonical create because index visibility timed out. Current mutation messages and `/v1/records/await` are a foundation, not a complete end-to-end acceptance matrix. See [write settling](../../next/app/src/pds.ts#L185) and [the ongoing notes](https://github.com/zzstoatzz/plyr.fm/issues/2303).

## Product port inventory

Existing production behavior is the review baseline. Each incomplete area needs implementation, an explicitly retained service, or an explicit defer/retire decision. Absence from the new route tree does not settle its scope.

| Area | Present in Next | Remaining port or acceptance work |
|---|---|---|
| Public catalog | Home, keyword search, artist/track/album/playlist details, library and likes | Finish discovery controls, pagination and production behavior rather than treating route presence as completion. [Catalog](../../next/app/src/Catalog.tsx#L25) |
| Discovery | Weekly top-five chart and Latest; keyword results with artwork | For You, semantic/CLAP search, tag browse/filtering, hidden tags, network discovery, chart period controls, Atlas. [Production route inventory](../../frontend/src/routes/) |
| Account entry | Typeahead, identity preview, original help copy, OAuth signup handoff | Remove or retain production discovery dependency; finish onboarding and listener/creator landing behavior; verify native OAuth and cancellation. [Login](../../next/app/app/login.tsx#L8) |
| Login intent | Explicit `return_to` survives web OAuth, including Jam links | Global capture is incomplete. Upload, Library, Portal and signed-out track actions still link to plain `/login`. Capture the return destination and preserve relevant draft context; automatic action replay needs an explicit design. [Library sign-in](../../next/app/src/AccountCatalog.tsx#L59), [callback](../../next/app/app/oauth/callback.tsx#L9) |
| Player and queue | Expo Audio, availability resolution, retry, startup timeout, seek, repeat, shuffle/remove/clear, now playing and native lock-screen setup | Queue/progress persistence, continuation semantics, title marquee, EQ, browser Media Session, keyboard shortcuts, interruptions/backgrounding, and production's accumulated queue edge cases. [Playback](../../next/app/src/playback.tsx#L15) |
| Plays and history | Backend play-credit/dedup endpoint and derived totals | The Next player makes no play-credit call. Port actual listened-time accounting, including radio; choose historical-total migration and attribution policy. Queue “played” means an in-memory prefix. Listening history/scrobbling and Teal/Rocksky consolidation remain a separate design decision. [Metrics](../../next/backend/src/internal/metrics/postgres_play_metric_store.zig#L1), [client API](../../next/app/src/api.ts#L154) |
| Preferences | Theme, accent, font, scale, keep-playing and play-through in a personal Space | Remaining production preference categories, conflicts/offline recovery, and policy for hosts without Spaces. [Preference schema](../../next/app/src/preference-space.ts#L7) |
| Upload/publishing | One public file, cover, metadata and locally measured duration; 100 MB client cap | Batch/album publishing, recording, tags/credits, visibility/download policies, large/resumable upload behavior, metadata extraction, replacement/revisions/optimization, rights controls and failure recovery. Album text currently does not create an album collection. [Upload](../../next/app/app/upload.tsx#L9), [PDS publication](../../next/app/src/pds.ts#L265) |
| Playlist editing | Create, rename, add a track, remove and delete; inline editing | Cover, reorder, add-from-editor workflow and privacy/profile visibility. [Collection editor](../../next/app/src/AccountCatalog.tsx#L193) |
| Album editing | Detail/read and rename | Album creation, artwork, member editing/reordering/removal, deletion, publishing and download policies. The current album editor is not the production editor port. [Collection editor](../../next/app/src/AccountCatalog.tsx#L193) |
| Creator portal/profile | First 50 owned tracks, upload/edit links, bio/avatar editing | Album management, search/sort/pagination, private tracks, support settings, storage/PDS repair, share management, copyright tools, export and account departure. [Portal](../../next/app/app/portal.tsx#L14), [production management](../../frontend/src/routes/portal/manage/+page.svelte) |
| Protected audio | Managed access checks and Space credential/fetch path | Converge with existing `fm.plyr.privateMedia` before gated publishing. Review response integrity too—the client requests a record MAC but currently uses `value.audioBlob` without verifying that MAC. [Protected fetch](../../next/app/src/gated-audio-shared.ts#L69) |
| Jams | Host-owned Space, current-track creation, invite by DID, join, polling, host play/pause/reset | Shared queue, track transitions, arbitrary seek, guest controls, participants, room lifecycle and invitations. Integrate or reconcile the separate command reducer; test concurrency, reconnect, revocation, host fencing and speaker/output ownership. Ownership transfer is later. [Running room](../../next/app/app/jam/[room].tsx#L52), [protocol probe](../../next/services/jams/README.md) |
| Radio | Four existing catalog stations, authoritative position, persistent tuned player and OBS link | Live/HLS preemption, firehose, presence/listeners, and play/scrobble accounting. Retain or replace the production-backed clock/delivery path. [Radio](../../next/app/src/RadioPlayer.tsx#L36) |
| Embeds | Track, album, playlist, artist and radio routes | Only track has the new responsive artwork design; Radio has its compact OBS layout. Port the remaining layouts, oEmbed/discovery and compatibility behavior. [Embed loader](../../next/app/src/CatalogEmbed.tsx#L33) |
| Moderation | Existing operator-label ingestion and some discovery/playback filtering; adult guard in track embeds | Viewer preferences, sensitive artwork/interstitials across the app, reports, account labels, acceptance for negation/expiry propagation, signed-label verification, copyright evidence/review/appeals and admin operations. Current label filtering is not the full moderation product. [Label sync](../../next/backend/src/internal/moderation/label_sync.zig#L1), [catalog rows](../../next/app/src/CatalogPieces.tsx#L102) |
| Public links and metadata | Opaque-ID Next routes; partial legacy resolution inside embeds | Existing numeric track/playlist URLs, album handle/slugs, AT-URI links, public liked-profile URLs, share attribution, canonical redirects, social previews and sitemap. [Legacy routes](../../frontend/src/routes/), [embed compatibility](../../next/app/src/CatalogEmbed.tsx#L19) |
| Activity and integrations | Core likes are projected | Listening/activity statistics, comments, now-playing presence, exports/downloads, Subsonic, public XRPC/developer interfaces, migration tools and support/profile workflows need explicit dispositions. [Production router](../../backend/src/backend/main.py#L180) |
| Legal and account lifecycle | Existing external account providers remain responsible for signup | Preserve terms/privacy access, deletion/deactivation behavior, data export and relevant consent flows through the new client/service boundary. [Production account API](../../backend/src/backend/api/account.py#L54) |
| Native and accessibility | Shared Expo project and CI native bundle exports; selected roles/labels and reduced-motion behavior | Installable releases, deep links, device OAuth, background audio, interruptions, lock screen, file picker/uploads, offline/download scope, VoiceOver/TalkBack, keyboard/focus and real-device Safari checks. [App configuration](../../next/app/app.json#L7), [web/native build workflow](../../.github/workflows/deploy-web-next.yml#L42) |
| SDK and MCP | Handwritten client API module | In-repo SDK generation, MCP built on it, external consumers and a coordinated contract/cutover plan. [Directory plan](../../next/README.md) |

The open [Now Playing PR #2336](https://github.com/zzstoatzz/plyr.fm/pull/2336) is not part of this checkpoint. Review its overlap with later merged player work before treating it as ready or counting its contents as shipped.

## Service and operational work

| Area | Remaining ownership or readiness work |
|---|---|
| Media processing | Integrate or deliberately retain the Rust transcoder and its format/size/retry contracts. Decide which service publishes derived artifacts without giving the appview canonical user-write ownership. [Transcoder](../internal/backend/transcoder.md) |
| Analysis and moderation | Reconnect CLAP embeddings and the scan → evidence → review → signed-label pipeline as selected product scope requires. The existing Rust and Modal services already have responsibilities that survive a main-backend rewrite. [Moderation overview](../internal/moderation/overview.md), [CLAP](../../services/clap/app.py) |
| Rebuild and freshness | Runtime isolation does not establish clean-database bootstrap. Migrations [0010](../../next/backend/migrations/0010_add_track_access_policies.sql) and [0012](../../next/backend/migrations/0012_add_track_metrics.sql) still import `public.tracks`. Rebaseline or account for those imports, then rehearse a clean index rebuild, compare it with the running index, include deletes/restrictions and retryable PDSes, test restart/replay/partial repair, and keep liveness separate from freshness. Historic reconcile counts and signing exceptions in #2303 need a fresh read before being called current. |
| Performance and recovery | Establish representative API/cold-start and ingestion/rebuild budgets. Prepared-statement caching and a failed pooled connection after Neon suspension remain tracked in [#2320](https://github.com/zzstoatzz/plyr.fm/issues/2320) and [#2319](https://github.com/zzstoatzz/plyr.fm/issues/2319). The pool's eager-start fix shipped in #2312. |
| State migration | Name the owner, source, lifetime and recovery rule for metrics, moderation decisions, pending tasks, preferences and historical private data. Rebuilding public records cannot recover every application-owned fact. |
| External contracts | Inventory clients, embeds, IDs/URLs, authentication/permissions and developer interfaces. A new REST contract needs explicit compatibility handling. |
| Coexistence | Assign one owner per side effect, including notifications, analysis, media derivation and play credit. Independent projections must not produce duplicate operational effects. |
| Cutover and rollback | Rehearse changing API/SDK/MCP/UI together, moving `next/` to the top level, retaining service dependencies deliberately, and restoring service after failure. Account for shared PDS writes and state that survives deploy rollback. |

## Questions to settle before their implementation slice

- Which production features are required for initial cutover, and which are explicitly deferred? The inventory above is the parity baseline for that discussion.
- What happens to historical play totals, share attribution and listening history? When do plays become interoperable records, local metrics, or both?
- Which private-media shape and scope set do existing users consent to, and how are old protected tracks preserved?
- What is the Jam acceptance contract for shared control, queue progression, room membership/revocation, output ownership and mobile backgrounding?
- How does a Spaces-first client treat a PDS without the required capabilities?
- Which production services and identifier/discovery read APIs remain after the main backend cuts over?
- What constitutes a native release and a cutover-ready web app, beyond passing bundle exports and happy-path browser tests?

## Documentation and handoff hygiene

This checkpoint supersedes the implementation status in the November 3 handoffs [#2315](https://github.com/zzstoatzz/plyr.fm/issues/2315) and [#2317](https://github.com/zzstoatzz/plyr.fm/issues/2317). They remain useful history; the migration hold and Svelte client references are obsolete. [#2303](https://github.com/zzstoatzz/plyr.fm/issues/2303) remains the running discussion, while this document is the scope inventory.

Further drift found during this audit includes the upstream-trust header in `stream_runner.zig`. The handler and collection-proof documentation describe the current verification boundary. Check implementation and merged history before turning an old handoff or an exploratory design into a new requirement.
