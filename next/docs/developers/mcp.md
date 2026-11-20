---
title: "MCP server"
description: "plyr.fm tools for AI assistants"
---

The plyr.fm MCP server exposes catalog queries as tools for AI assistants.
It is read-only.

## connect

```bash
# placeholder: hosted endpoint URL and client setup command
```

## tools

Placeholder list. Tool names will follow the XRPC methods.

| tool | purpose |
| --- | --- |
| `search` | find tracks, artists, albums and playlists |
| `get_track` | one track and its metadata |
| `top_tracks` | the most liked tracks over a period |
| `latest_tracks` | the newest public tracks |
| `get_list` | an album or playlist and its tracks |

## changes to an account

The MCP server does not write records. Use the SDK or write records to the
PDS directly.
