---
title: "for developers"
description: "build on plyr.fm: XRPC API, lexicons, SDK and MCP"
---

plyr.fm data is public atproto records. You can read them from any PDS or
relay, or query the plyr.fm appview, which indexes them.

## surfaces

- [XRPC API](/developers/xrpc/): queries and procedures under `fm.plyr.*`.
- [lexicons](/lexicons/): record types and method schemas.
- [SDK](/developers/sdk/): a typed client for the XRPC API.
- [MCP server](/developers/mcp/): tools for AI assistants.

## writing data

The appview does not write records. To publish a track, like or playlist,
write the record to the account's PDS with `com.atproto.repo.createRecord`.

## start here

1. [quickstart](/developers/quickstart/)
2. [authentication](/developers/auth/)
