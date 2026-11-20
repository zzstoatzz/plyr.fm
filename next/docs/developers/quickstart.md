---
title: "quickstart"
description: "read the plyr.fm catalog with one request"
---

Public queries need no authentication.

```bash
curl 'https://api.plyr.fm/xrpc/fm.plyr.unspecced.getTopTracks?period=week&limit=5'
```

Each result contains the track record as the artist wrote it, its AT URI, and
counts such as likes.

## next steps

- List recent tracks with `fm.plyr.unspecced.getLatestTracks`.
- See the [XRPC reference](/developers/xrpc/) for all methods.
- See [authentication](/developers/auth/) for methods that act on an account.
