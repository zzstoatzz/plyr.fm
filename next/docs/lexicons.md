---
title: "lexicons"
description: "record types and methods under fm.plyr"
---

All plyr.fm data uses lexicons under the `fm.plyr` namespace. The JSON
definitions in the repository are the source of truth.

## records

| NSID | purpose |
| --- | --- |
| `fm.plyr.track` | an audio track |
| `fm.plyr.list` | an album or playlist |
| `fm.plyr.like` | a like on a track |
| `fm.plyr.comment` | a timed comment on a track |
| `fm.plyr.actor.profile` | an artist profile |
| `fm.plyr.policy` | access rules for a closed release |
| `fm.plyr.release` | a release |

## namespaces

- `fm.plyr.*`: shared catalog records and public methods.
- `fm.plyr.unspecced.*`: methods that may change without notice.
- `fm.plyr.next.*`: types used only by the Next service (audio spaces, jams).

## methods

See the [XRPC reference](/developers/xrpc/).
