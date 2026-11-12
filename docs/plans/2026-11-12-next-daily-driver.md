# next as the daily driver

November 12, 2026. Authorized implementation goal, starting at `109b6899a`.

Make Next so much better to use that replacing production is the obvious next
decision. One parity pass establishes the boundary below; subsequent cycles ship
working journeys instead of reopening the audit. Production cutover is separate.

## what parity means for this MVP

| Outcome | Required behavior |
|---|---|
| Get into my account | Real OAuth, return to the intended action, account switching and isolation; queue/settings sync without requiring Spaces. |
| Find something worth playing | Fast home, charts, tags, followed artists, search and browsable artist/album/playlist pages; preferences prevent unwanted discovery. |
| Listen without thinking about the player | Immediate feedback, reliable audio, seek/skip/repeat/shuffle, queue edits and paused restoration; navigation never interrupts audio. Now Playing sets the visual and interaction standard. |
| Keep and organize music | Likes and usable playlist/album management, with edits surviving retries and appview delay without duplicate records. |
| Publish and maintain my work | Upload, artwork, metadata/tags, collections, edit/replace/delete, useful progress and recovery; existing access/download policies stay intact. Large files must not silently lose production support. |
| Listen together | Existing Next radio and Jams remain usable through reconnects and transitions; no regression of independent playback or membership checks. |
| Trust the service | Existing restrictions and moderation decisions remain effective; no accidental private metadata/artwork exposure, lost writes or duplicate operational effects. |

The November 7 inventory remains the full eventual-cutover backlog, not a demand
to implement every legacy subsystem before this MVP is useful. No claim of full
production parity is made while its remaining journeys are deferred.

## outside this MVP

- Production domain/API cutover, legacy retirement and App Store replacement.
- Complete Subsonic/third-party API compatibility, SDK/MCP, all legacy URL migration.
- Historical analytics migration, complete scrobbling interoperability, Atlas,
  semantic discovery, timed comments and expanded social features.
- A new moderation policy or elaborate operator platform. Preserve the primitives
  and restrictions; improve the temporary implementation only where correctness
  or the daily experience requires it.
- Replacing working Rust/Modal services, ZKV migration, a language-purity rewrite,
  speculative scale architecture or a broad mechanical directory migration.

These remain explicit follow-up work before full replacement; existing production
continues serving them. Native build/device smoke is in this effort, native release
and comprehensive old-app state migration are not its finish line.

## execute in order

1. Establish the backend baseline and remove demonstrated latency/recovery
   bottlenecks. Keep canonical writes in clients, verified/rebuildable projections
   in the appview, and named recovery rules for service-owned state. Compare warm
   and cold reads separately; correctness under failure precedes throughput claims.
2. Fan out over independent UI journeys using the existing palette, materials,
   controls and Now Playing behavior. Keep routes thin, state ownership singular,
   platform seams named and shared components genuinely shared. Concise subtree
   AGENTS.md files establish those boundaries; don't grow a framework for them.
3. Close the required journey gaps, exercise them against real services and
   inspect phone/desktop, light/dark, populated/empty/error states. Carry fixes
   through reviewed PRs and Next deployment, preserving normal production.

Each slice records its actual revision, commands, observations and limitations.
Repair stale checks without weakening what they prove. Accepted PDS writes remain
accepted even if projection times out; never replay a create to hide that delay.

## measurement and finish line

Use existing backend parity benchmarks on disposable data and a bounded live
read sample. Record p50/p95/p99 with dataset, concurrency and cache state; do not
call a workstation median a production SLO. Initial engineering targets are warm
regional API p95 below 150 ms and no stale-connection first-request 503. Investigate
misses, rather than adding infrastructure or silently changing the target.

Measure the user's experience too: first usable content, first audible sample,
seek response and navigation while playing. Keep existing content visible during
refresh, acknowledge taps immediately and verify actual audio rather than flags.

The MVP is ready when the required outcomes above work, the key browser checks
are green, the rendered app has been inspected, native smoke limitations are
explicit, and the remaining defects are small named rough edges rather than
missing daily journeys. A cost snapshot records the current footprint and likely
retirement savings; a billing optimization program does not delay the product.

Production remains isolated operationally, but its user records are shared.
Preserve lexicons/unknown fields and compare-and-swap writes. Keep one owner per
scan, notification and other side effect. Neither load tests nor fault injection
run against production. Docs for the eventual cutover stay staged until then.

## execution evidence

- Scope and source baseline: November 12 handoff, November 7 rewrite inventory,
  current app/backend source and workflows at `109b6899a`.
- First slices: backend stale-connection/statement-planning investigation;
  scoped app/backend structure rules; repair the three browser checks in #2485.
