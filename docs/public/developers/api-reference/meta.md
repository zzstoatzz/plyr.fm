---
title: meta
sidebarTitle: meta
---

# `backend.api.meta`


meta endpoints — health, config, OAuth metadata, robots, sitemap.

## Functions

### `health` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/meta.py#L19)

```python
health() -> dict[str, str]
```


health check endpoint.


### `get_public_config` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/meta.py#L25)

```python
get_public_config() -> dict[str, int | str | list[str]]
```


expose public configuration to frontend.


### `client_metadata` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/meta.py#L44)

```python
client_metadata() -> dict[str, Any]
```


serve OAuth client metadata.

returns metadata for public or confidential client depending on
whether OAUTH_JWK is configured.


### `jwks_endpoint` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/meta.py#L81)

```python
jwks_endpoint() -> dict[str, Any]
```


serve public JWKS for confidential client authentication.

returns 404 if confidential client is not configured.


### `robots_txt` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/meta.py#L97)

```python
robots_txt()
```


serve robots.txt to tell crawlers this is an API, not a website.


### `sitemap_data` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/meta.py#L106)

```python
sitemap_data(db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, Any]
```


return minimal data needed to generate sitemap.xml.

returns tracks, artists, and albums with just IDs/slugs and timestamps.
the frontend renders this into XML at /sitemap.xml.


### `proxy_browser_telemetry` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/meta.py#L154)

```python
proxy_browser_telemetry(request: Request)
```


forward browser telemetry to Logfire.

proxies OpenTelemetry data from the browser SDK so the write token
stays server-side. protected by CORS (allowed origins only) and
global rate limiting.

