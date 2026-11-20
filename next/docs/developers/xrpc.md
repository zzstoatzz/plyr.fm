---
title: "XRPC reference"
description: "queries and procedures served by the plyr.fm appview"
---

The appview serves XRPC methods at `https://api.plyr.fm/xrpc/{nsid}`. Queries
use `GET`; procedures use `POST` with a JSON body. Errors return a JSON body
with `error` and `message`.

Methods under `fm.plyr.unspecced.*` may change without notice.

## catalog

| method | type | auth | description |
| --- | --- | --- | --- |
| `fm.plyr.unspecced.getTopTracks` | query | none | most liked tracks over a period |
| `fm.plyr.unspecced.getLatestTracks` | query | none | newest public tracks |

## notifications

| method | type | auth | description |
| --- | --- | --- | --- |
| `fm.plyr.notification.listNotifications` | query | service | the account's notifications |
| `fm.plyr.notification.getUnreadCount` | query | service | count of unseen notifications |
| `fm.plyr.notification.updateSeen` | procedure | service | mark notifications seen |

## moderation

| method | type | auth | description |
| --- | --- | --- | --- |
| `fm.plyr.moderation.createReport` | procedure | service | report a subject |
| `com.atproto.label.queryLabels` | query | none | labels issued by the plyr.fm labeler |

## pagination

List methods take `limit` and `cursor` and return `cursor` when more results
exist.
