---
title: artists
sidebarTitle: artists
---

# `backend.api.artists`


artist profile API endpoints.

## Functions

### `create_artist` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L84)

```python
create_artist(request: CreateArtistRequest, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Session = Depends(require_auth)) -> ArtistResponse
```


create or update artist profile for authenticated user.

if a minimal Artist record was created during OAuth login, this updates it
with the user's profile setup choices. otherwise creates a new record.


### `get_my_artist_profile` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L161)

```python
get_my_artist_profile(db: Annotated[AsyncSession, Depends(get_db)], auth_session: Session = Depends(require_auth)) -> ArtistResponse
```


get authenticated user's artist profile.


### `update_my_artist_profile` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L178)

```python
update_my_artist_profile(request: UpdateArtistRequest, db: Annotated[AsyncSession, Depends(get_db)], auth_session: Session = Depends(require_auth)) -> ArtistResponse
```


update authenticated user's artist profile.


### `get_artists_batch` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L221)

```python
get_artists_batch(dids: list[str], db: Annotated[AsyncSession, Depends(get_db)]) -> dict[str, ArtistResponse]
```


get artist profiles for multiple DIDs (public endpoint).

returns a dict mapping DID -> artist data for any DIDs that exist in our database.
DIDs not found are simply omitted from the response.


### `get_artist_profile_by_handle` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L240)

```python
get_artist_profile_by_handle(handle: str, db: Annotated[AsyncSession, Depends(get_db)]) -> ArtistResponse
```


get artist profile by handle (public endpoint).


### `get_artist_profile_by_did` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L262)

```python
get_artist_profile_by_did(did: str, db: Annotated[AsyncSession, Depends(get_db)]) -> ArtistResponse
```


get artist profile by DID (public endpoint).


### `get_artist_analytics` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L284)

```python
get_artist_analytics(artist_did: str, db: Annotated[AsyncSession, Depends(get_db)]) -> AnalyticsResponse
```


get public analytics for any artist by DID.

returns zeros if artist has no tracks.


### `get_my_analytics` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L351)

```python
get_my_analytics(db: Annotated[AsyncSession, Depends(get_db)], auth_session: Session = Depends(require_auth)) -> AnalyticsResponse
```


get analytics for authenticated artist.

returns zeros if artist has no tracks - no need to verify artist exists.


### `refresh_artist_avatar` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L369)

```python
refresh_artist_avatar(did: str, db: Annotated[AsyncSession, Depends(get_db)]) -> RefreshAvatarResponse
```


refresh an artist's avatar from Bluesky (public endpoint).

called when the frontend detects a stale/broken avatar URL (404).
fetches the current avatar from Bluesky and updates the database.


## Classes

### `CreateArtistRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L26)


request to create artist profile.


### `UpdateArtistRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L34)


request to update artist profile.


### `ArtistResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L42)


artist profile response.


**Methods:**

#### `normalize_avatar` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L59)

```python
normalize_avatar(cls, v: str | None) -> str | None
```

normalize avatar URL to use Bluesky CDN.


### `TopItemResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L64)


top item in analytics.


### `AnalyticsResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L72)


analytics data for artist.


### `RefreshAvatarResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/artists.py#L362)


response from avatar refresh.

