---
title: oembed
sidebarTitle: oembed
---

# `backend.api.oembed`


oEmbed endpoint for track, playlist, and album embeds.

Enables services like Leaflet.pub (via iframely) to discover
and use our embed player instead of raw HTML5 audio.


## Functions

### `get_oembed` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/oembed.py#L154)

```python
get_oembed(url: Annotated[str, Query(description='URL to get oEmbed data for')], db: Annotated[AsyncSession, Depends(get_db)], maxwidth: Annotated[int | None, Query()] = None, maxheight: Annotated[int | None, Query()] = None, format: Annotated[str, Query()] = 'json') -> OEmbedResponse
```


Return oEmbed data for a track, playlist, or album URL.

This enables services like iframely to discover our embed player.


## Classes

### `OEmbedResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/oembed.py#L28)


oEmbed response for embeds.

