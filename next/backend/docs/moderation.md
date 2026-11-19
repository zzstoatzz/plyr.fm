# moderation

Next's moderation follows prod's goals (`docs/public/moderation.md`) and is
being rebuilt on ROOST's tooling: a slim Osprey worker flags, people decide in
a queue inside next, and a labeler signs the result as `moderation.plyr.fm`.
This page covers the part that exists: the log.

## the log

`plyr_moderation.events` (migration 0048) is append-only operational state
the API owns. A replay of the network cannot rebuild it, so it is never
truncated. Each entry names a subject (a record's AT URI or an account DID),
an action, and an actor.

| action | opens review | closes review | projects |
|---|---|---|---|
| `reported` | yes | | |
| `flagged_by_scan` | yes | | |
| `flagged_by_rule` | yes | | |
| `acknowledged` | | yes | |
| `override_allow` | | yes | `moderation_decision = 'allow'` |
| `override_exclude` | | yes | `moderation_decision = 'exclude'` |
| `override_clear` | | | clears the decision |

A subject is in the queue when its newest opening entry has no closing entry
after it, so a new report on an acknowledged track reopens it. Decisions on a
track are written to `plyr_index.track_policies` in the same transaction as
the entry (`moderation_write_source = 'moderation_log'`), which is what feeds,
search, radio and stats already read. `allow` lifts copyright de-listing;
`exclude` keeps a track off list surfaces but not off its own page.

Labels, takedowns and indexing exclusions are not in the vocabulary yet. They
join when something on next acts on them.

## who may write

Every method takes the caller's service JWT, minted by their PDS for this
service and this method, like notifications. `actor` is the verified issuer.

| method | who | does |
|---|---|---|
| `fm.plyr.moderation.createReport` (POST) | anyone signed in | `{subject, reasonType, reason?}`; the subject must be a track, comment or account plyr has seen; one per reporter per subject per day (repeats dropped silently), 30 per reporter per hour |
| `fm.plyr.moderation.getQueue` (GET) | operators | open subjects, oldest first, `?limit=` up to 200, `?cursor=` from the last page |
| `fm.plyr.moderation.getSubject` (GET) | operators | every entry for `?subject=` |
| `fm.plyr.moderation.emitEvent` (POST) | operators | `{subject, action, reason?}`; actions limited to decisions, and allow/exclude only on tracks for now |

Writes to one subject (and reports from one reporter) take an advisory lock,
so the newest log entry is always what listeners see.

Operators are the DIDs in `MODERATION_OPERATOR_DIDS`. With none configured,
reports are still accepted and nobody can read them.

`reasonType` is one of `copyright`, `sexual`, `spam`, `harassment`,
`impersonation`, `other`.
