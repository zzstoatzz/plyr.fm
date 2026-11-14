# backend structure

## who writes what

One binary runs every role (`MODE` or the Fly process group picks it). Each
table has one writing module; everything else reads.

| role | module | writes |
| --- | --- | --- |
| ingester | `internal/projection` | `plyr_index.track_records`, `track_tag_records`, `list_records`, `list_members`, `like_records`, `profile_records`, `repo_heads`, `record_rejections` |
| ingester | `internal/ingest` | `plyr_index.relay_cursors` (stream sources) |
| ingester (side thread) / mirror | `internal/delivery` | `plyr_index.track_delivery_origins`, `track_mirror_attempts` |
| ingester (side thread) | `internal/identity` | `plyr_index.actor_identities` |
| ingester (side thread) | `internal/moderation` | `plyr_index.track_policies`, `account_label_policies`, the labeler's `relay_cursors` row |
| space_consumer | `internal/space` (`postgres_sync_store`) | `plyr_index.space_records`, `space_cursors` |
| account_reconciler | `internal/account` | `plyr_index.account_availability`, `account_status_checks` |
| api | `internal/metrics` | `plyr_index.track_metrics` through `plyr_index.record_play()` |
| api | `internal/notification` | `plyr_account.notification_seen` |
| jams (coordinator) | `internal/jams` | `plyr_playback.queue_records` (Redis holds the live copy) |
| jams (coordinator) | `internal/coordinator` | `plyr_account.preferences` |

`catalog_reconciler` and `repair` write through `internal/projection` like the
ingester. A new writer for an existing table belongs in that table's module.

## source layout

- `src/api/`: HTTP for the `api` role (router, one file per resource).
- `src/internal/coordinator/`: the `jams` role's process: websocket server,
  room join, preferences, and the upload/download authorize routes.
- `src/internal/jams/`: rooms and queues only (model, protocol, store,
  tickets, room admission).
- `src/internal/net/`: SSRF-safe endpoint resolution and pinned TLS, shared by
  every module that fetches from a PDS or DID host.
- `src/internal/atproto/`: record parsing, space addresses (`space_uri.zig`)
  and the one service-JWT verifier (`service_auth.zig`) both servers use.
- `src/internal/space/`: the access core (Decider, policies, payment evidence).
