# Next rewrite progress and scope

**Created** November 4, 2026. **Updated** November 6, 2026.

**Code checkpoint** `e98a14198` on main, through #2436.

**Purpose** Track the architectural rewrite, shipped foundations, remaining ports,
and decisions required before each implementation slice.

The inventory now incorporates merged work through this checkpoint rather than
leaving the November 4 table as the current to-do list. Implementation, browser
acceptance, real-device acceptance and cutover readiness remain separate claims.
This update reviewed source, merged history and existing verification reports; it
did not rerun backend acceptance, infrastructure failure tests or billing queries.

## Current position

The core has advanced beyond a replatform: direct client-to-PDS writes and
independent appview verification now coexist with durable anonymous play receipts,
verified browser Range delivery for private audio, and real-time Spaces-backed
Jam rooms coordinated across two Zig instances through Redis. Neon remains the
derived catalog/accounting store; no SQL writes occur per playback tick.

| Recent slice | Shipped and verified | Boundary still open |
|---|---|---|
| Play accounting, #2363/#2364/#2366/#2370 | Actual listened time, stable occurrence IDs, bounded durable client outbox, transactional Postgres receipt/cooldown/count; solo, catalog embeds, radio and audible Jam output use the shared qualification model. [Design](../internal/architecture/next-play-accounting.md), [browser evidence](2026-11-04-playback-browser-workflow.md). | Historical totals, private history/scrobbling, ingress abuse policy and long-term receipt growth; physical-device/background acceptance. |
| Protected audio, #2421/#2426 | Record MAC verification and client-owned browser Range capabilities, with scoped image resolution. [Acceptance report](2026-11-05-private-audio-streaming.md). | Native remains file-backed; existing private-media compatibility and complete gated publishing still need their own port slice. |
| Real-time Jams, #2422–#2425/#2428–#2430 | Real OAuth create/invite/join, explicit play/pause, host seeking, shared queue coordination and reconnect; two independent public browsers decoded audio and survived verified coordinator SIGKILL. [Completion audit](2026-11-06-jams-live-verification.md). | One Redis primary, admission-bounded revocation, one-speaker routing, native/background behavior and larger concurrency acceptance. This is the scoped MVP, not full legacy parity. |
| Discovery and management, #2381/#2408/#2411/#2412/#2415 | Paginated creator tracks/albums, cancellable search reads with artwork, metrics hydrated after ranking/limiting, colored tags, automatic Home pagination and network artists. | For You, semantic/CLAP search, hidden tags and full publishing/collection editing remain. |
| Stats, #2432 | Explained public totals for tracks, artists, duration and Next-qualified plays, excluding private/unlisted/removed records; cached rather than scanning on each request. | Not production historical counts or private listening analytics. Curate new metrics with explicit sources/definitions. |
| Player and UI, #2429/#2435/#2436 | Scrubbing crash/snap-back fixed; direct queue drag, persistent dock, shortcuts and swipe behavior. Latest live UI has no outer beveled frame/gutters, a thin full-width status light, quieter navigation and no disabled end-of-feed button. | UI remains iterative. Two-column desktop feed is provisional, not a parity requirement. Physical iPhone/native behavior remains unverified. |

The #2435 visual implementation was revised in #2436 after product review;
the mockup is not a standing specification. Keep the current decisions in
[#2431](https://github.com/zzstoatzz/plyr.fm/issues/2431). #2436 also fixes a
signed-in-only Firefox/Zen page-load crash: Expo Router merged an artist link's
style array into numbered CSS properties. Its regression renders network artists
with fixture auth/follow responses; anonymous-only browser checks missed it.

The backend play path and Jam failure evidence are recorded separately from UI
checks. The latest frontend passed seven live viewport/theme cases and the
Firefox artist-render/navigation regression; the real Zen browser was reloaded
and inspected. None of this establishes full native acceptance.

**Working order:** finish core feature journeys in small cycles, preserving
production behavior and explicit failure/recovery contracts. Personal listening
and player continuity are the next uncompleted planned cycles; their order is a
product choice, not work already underway. No new runtime goal starts with this
inventory update. SDK/MCP, legacy-URL work and cutover rehearsal remain deferred.

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
| Jams | Creator-owned Space create/invite/join; shared queue and explicit controls, host-only seek, Redis clock/revision/epoch fencing, reconnect with fresh admission and cross-instance fan-out | One-speaker routing, immediate revocation, room lifecycle/invitation polish, physical-device/native background acceptance and Redis failover. Ownership transfer remains later. [MVP audit](2026-11-06-jams-live-verification.md) |
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
| Spaces, #2330/#2335/#2338 | Private preferences and creator-owned room snapshots established real PDS/OAuth paths. The later #2422–#2430 arc connected the running room to cross-instance command coordination and tested real recovery; the earlier polling implementation is superseded. |
| React Native, #2331–#2342 | Replacing the UI exposed lost product behavior in playback, queue, artwork, editors, and navigation. Framework replacement did not preserve that work automatically. |
| Radio/auth/embeds, #2343–#2360 | Product review caught integration and layout problems that successful builds missed. Playback needed a shared persistent player, server-derived radio position, real retry checks, original account copy, actual iframe size tests, and document-level Safari theming. |

The reference for a port should be production behavior and its incident/history arc, followed by the corresponding failure cases in the new architecture. A screen rendering, a bundle compiling, a reducer passing, or a PDS write succeeding each proves a different boundary.

The saved/indexed distinction remains important. An accepted PDS write can be pending or rejected by the index. Recovery must retain its URI/CID and avoid repeating a canonical create because index visibility timed out. Current mutation messages and `/v1/records/await` are a foundation, not a complete end-to-end acceptance matrix. See [write settling](../../next/app/src/pds.ts#L185) and [the ongoing notes](https://github.com/zzstoatzz/plyr.fm/issues/2303).

## Product port inventory

Existing production behavior is the review baseline. Each incomplete area needs implementation, an explicitly retained service, or an explicit defer/retire decision. Absence from the new route tree does not settle its scope.

| Area | Present in Next | Remaining port or acceptance work |
|---|---|---|
| Public catalog | Home, keyword search, artist/track/album/playlist details, library and likes | Finish discovery controls, pagination and production behavior rather than treating route presence as completion. [Catalog](../../next/app/src/Catalog.tsx#L25) |
| Discovery | Period-selectable charts, Latest, server tag filters, colored tags, automatic feed pagination and network artists; cancellable keyword search with artwork | For You, semantic/CLAP search, hidden tags, broader browse/Atlas behavior and representative performance budgets. Ranking/limit precede search metric hydration (#2408). [Home](../../next/app/src/Home.tsx), [Search](../../next/app/src/Search.tsx) |
| Account entry | Typeahead, identity preview, original help copy, OAuth signup handoff | Remove or retain production discovery dependency; finish onboarding and listener/creator landing behavior; verify native OAuth and cancellation. [Login](../../next/app/app/login.tsx#L8) |
| Login intent | Explicit return destinations survive web OAuth for Jam links and creation, Portal and signed-out track actions | Audit every protected journey and draft boundary, including Upload and Library; automatic action replay is a separate design. A Jam permission upgrade is distinct from being signed out (#2396). [Intent](../../next/app/app/oauth/callback.tsx), [Portal](../../next/app/src/Portal.tsx) |
| Player and queue | Expo Audio, availability/retry/startup timeout, stable seek preview, repeat/shuffle/remove/clear, direct drag reorder, persistent dock, full-screen Now Playing, keyboard shortcuts and swipe navigation/dismissal | Queue/progress persistence, explicit versus generated queue semantics, title marquee, EQ, platform media controls and interruptions/backgrounding still need acceptance. Navigation/seek checks do not prove native lifecycle parity. [Playback](../../next/app/src/playback.tsx) |
| Plays and history | Qualified listened-time accounting and receipt outbox integrated into solo, catalog embeds, radio and audible Jam playback; durable atomic Postgres receipts and totals | Historical-total migration, share attribution, private listening history and Teal/Rocksky interoperability are undecided. Cooldown suppression is distinct from receipt idempotency. [Accounting](../internal/architecture/next-play-accounting.md) |
| Preferences | Theme, accent, font, scale, keep-playing and play-through in a personal Space | Remaining production preference categories, conflicts/offline recovery, and policy for hosts without Spaces. [Preference schema](../../next/app/src/preference-space.ts#L7) |
| Upload/publishing | One public file, cover, metadata and locally measured duration; 100 MB client cap | Batch/album publishing, recording, tags/credits, visibility/download policies, large/resumable upload behavior, metadata extraction, replacement/revisions/optimization, rights controls and failure recovery. Album text currently does not create an album collection. [Upload](../../next/app/app/upload.tsx#L9), [PDS publication](../../next/app/src/pds.ts#L265) |
| Playlist editing | Create, rename, add a track, remove and delete; inline editing | Cover, reorder, add-from-editor workflow and privacy/profile visibility. [Collection editor](../../next/app/src/AccountCatalog.tsx#L193) |
| Album editing | Detail/read and rename | Album creation, artwork, member editing/reordering/removal, deletion, publishing and download policies. The current album editor is not the production editor port. [Collection editor](../../next/app/src/AccountCatalog.tsx#L193) |
| Creator portal/profile | Paginated owned tracks and albums, track search/order controls, upload/edit links and bio/avatar editing (#2381) | Album creation/member editing, private tracks, support settings, storage/PDS repair, share management, copyright tools, export and account departure. Route presence does not establish these workflows. [Portal](../../next/app/src/Portal.tsx) |
| Protected audio | Managed access checks, verified Space record MAC and browser signed Range delivery; separate scoped image resolution | Converge with existing private-media records and complete gated publishing; native streaming/lifecycle acceptance remains separate. Jam membership does not grant audio access. [Protected fetch](../../next/app/src/gated-audio-shared.ts), [report](2026-11-05-private-audio-streaming.md) |
| Jams | Creator-owned Space create/invite/join; shared queue and explicit controls, host-only seek, Redis clock/revision/epoch fencing, reconnect with fresh admission and cross-instance fan-out | One-speaker routing, immediate revocation, room lifecycle/invitation polish, physical-device/native background acceptance and Redis failover. Ownership transfer remains later. [MVP audit](2026-11-06-jams-live-verification.md) |
| Radio | Four existing stations, authoritative clock, persistent tuned player, OBS link, qualified catalog accounting and decoded Jam-to-radio handoff | Live/HLS preemption, firehose, presence/listeners and personal scrobbling. Retain or replace the production-backed clock/delivery path deliberately. Operator radio exclusions shipped separately in legacy backend #2434; this is not a new Next eligibility engine. [Radio](../../next/app/src/RadioPlayer.tsx) |
| Embeds | Track, album, playlist, artist and radio routes | Only track has the new responsive artwork design; Radio has its compact OBS layout. Port the remaining layouts, oEmbed/discovery and compatibility behavior. [Embed loader](../../next/app/src/CatalogEmbed.tsx#L33) |
| Moderation | Existing operator-label ingestion and some discovery/playback filtering; adult guard in track embeds | Viewer preferences, sensitive artwork/interstitials across the app, reports, account labels, acceptance for negation/expiry propagation, signed-label verification, copyright evidence/review/appeals and admin operations. Current label filtering is not the full moderation product. [Label sync](../../next/backend/src/internal/moderation/label_sync.zig#L1), [catalog rows](../../next/app/src/CatalogPieces.tsx#L102) |
| Public links and metadata | Opaque-ID Next routes; partial legacy resolution inside embeds | Existing numeric track/playlist URLs, album handle/slugs, AT-URI links, public liked-profile URLs, share attribution, canonical redirects, social previews and sitemap. [Legacy routes](../../frontend/src/routes/), [embed compatibility](../../next/app/src/CatalogEmbed.tsx#L19) |
| Activity and integrations | Projected likes and public /stats catalog/accounting totals | Private listening/activity analytics, timed comments (studied in #2383, not implemented), presence, exports/downloads, Subsonic and migration/support tools need explicit dispositions. Developer SDK/MCP work remains deferred. [Stats](../../next/app/app/stats.tsx) |
| Legal and account lifecycle | Existing external account providers remain responsible for signup | Preserve terms/privacy access, deletion/deactivation behavior, data export and relevant consent flows through the new client/service boundary. [Production account API](../../backend/src/backend/api/account.py#L54) |
| Native and accessibility | Shared Expo project and CI native bundle exports; selected roles/labels and reduced-motion behavior | Installable releases, deep links, device OAuth, background audio, interruptions, lock screen, file picker/uploads, offline/download scope, VoiceOver/TalkBack, keyboard/focus and real-device Safari checks. [App configuration](../../next/app/app.json#L7), [web/native build workflow](../../.github/workflows/deploy-web-next.yml#L42) |
| SDK and MCP | Handwritten client API module | Explicitly deferred: SDK generation, MCP, external consumers and coordinated cutover planning. Not a prerequisite for current core parity work. [Directory plan](../../next/README.md) |

The still-open [Now Playing PR #2336](https://github.com/zzstoatzz/plyr.fm/pull/2336) is not counted as shipped. Its older proposal overlaps later merged player work; reassess or close it rather than treating it as the next implementation plan.

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

## Storage and operating cost

- Neon/Postgres owns verified catalog projections, play receipts/cooldowns and
  serving aggregates. The client owns pending receipt persistence; no network
  round trip occurs per media progress tick. Receipts are currently retained
  indefinitely, so storage growth is a real ongoing cost.
- Private preference/room records and media remain on the user's PDS/Spaces.
  Redis owns operational Jam sequencing, deduplication and snapshots; it is not
  the canonical user repository. Docket is not in the playback command path.
- The [cost checkpoint](../../COSTS.md#next-backend-checkpoint-november-4-2026)
  estimated roughly $30–35/month for the observed pre-Jam Next baseline, with
  missing usage categories called out. Jams adds a historical estimate of about
  $6.72/month for two coordinators, dedicated persistent Redis and its volume.
  These are dated estimates, not refreshed billing or a new total invoice.
  Always-on ingestion/database/Redis costs persist even when the API sleeps.

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
