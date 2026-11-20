---
title: "authentication"
description: "atproto OAuth and service auth for plyr.fm"
---

plyr.fm uses atproto OAuth. There are no plyr.fm passwords or API keys.

## reading

Public queries need no authentication.

## writing records

Sign the user in with atproto OAuth, then write records to their PDS. The
appview picks up the new record from the network.

## authenticated methods

Methods that act for an account, such as notifications, require atproto
service auth. Call them through the user's PDS with the
`atproto-proxy` header set to `{plyr.fm service DID}#plyr_appview`, or send a
service auth token in the `Authorization: Bearer` header.

## scopes

Request only the collections your app writes. Every `space:` scope must name
a collection.
