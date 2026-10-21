---
title: "track tags and PDS reconciliation"
---

`fm.plyr.track.tags` is an optional string array, limited to twenty tags of at most
50 characters each. The existing API/editor limit remains ten; the record limit
accommodates legacy automatic tagging (one production track had eleven). API writes and the index normalize whitespace and case;
external records remain as written by their owner. A malformed tag field rejects
the incoming record without clearing existing tags.

## Authority and migration

The PDS is authoritative. Explicit `tags`, including `[]`, replace the index.
`Track.extra.tags_pds_synced` records that a track has crossed from the old
DB-only implementation. Until then, an absent field preserves legacy DB tags.
Afterward, absence clears tags. New uploads and new externally created tracks
start reconciled, including when they have no tags.

Login synchronization reconciles legacy tracks using the owner's authorized
session. It fetches the record, publishes DB tags only when the field is absent,
and otherwise adopts the PDS tags. Displaced legacy tags are retained in
`Track.extra.legacy_tags` for recovery; they are never automatically merged back.
Migration is idempotent. Failed or conflicting writes leave the track pending for
another sync. Owners who do not return retain their existing DB-only tags until
authorized reconciliation is possible.

## Writes and ordering

Uploads include tags in the initial public or private-space record. Pending DB
rows include the same tags so upload finalization and the Jetstream echo cannot
race a late tag insert. Metadata edits patch only requested fields on a freshly
fetched record. Other track rebuilds preserve its tags, unknown fields and
`createdAt`. Updates use `swapRecord` with the fetched CID; conflicts fail instead
of overwriting a concurrent edit.

Tag projection, migration state and the applied commit revision are committed
together. Edits, ingestion and migration lock the track row to serialize those
updates. Successful tag writes record the returned commit revision in `tags_pds_rev`
so an older Jetstream event cannot undo them. This fence applies only to tags;
the echo still updates other fields discovered in the fetched record. A write failure rolls back the DB edit; a PDS
success followed by a DB failure can be recovered by its Jetstream event or an
explicit refresh. A transient mismatch between PDS and the index remains possible.

Opted-in genre tags publish before entering the index. Failed automatic writes
retain `auto_tag` and predictions for retry on login. Explicit API tag edits and
external tag changes cancel pending automatic tagging. Suggestions alone are
not public tags. Private-track edits remain unsupported; private uploads carry
their tags in their permissioned record and never use public reconciliation.

## Refresh an existing record

With the backend configured for the intended environment:

```sh
uv run --project backend scripts/sync_track_tags.py --artist-did did:plc:example
```

This reads the PDS and updates only the index; it does not publish DB-only tags.
Use `--track-id` to scope to one track. For an authorized migration, set the
owner's session in `PLYR_TAG_SYNC_SESSION` and add `--write-with-session`.
Never pass the session as a command-line argument. The script only writes records
owned by that session. Production reconciliation is a separate operational step
following production promotion; staging uses its own database and collection.
