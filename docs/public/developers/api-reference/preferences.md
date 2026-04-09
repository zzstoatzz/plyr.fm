---
title: preferences
sidebarTitle: preferences
---

# `backend.api.preferences`


user preferences api endpoints.

## Functions

### `get_preferences` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/preferences.py#L82)

```python
get_preferences(db: Annotated[AsyncSession, Depends(get_db)], session: Session = Depends(require_auth)) -> PreferencesResponse
```


get user preferences (creates default if not exists).


### `update_preferences` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/preferences.py#L124)

```python
update_preferences(update: PreferencesUpdate, db: Annotated[AsyncSession, Depends(get_db)], session: Session = Depends(require_auth)) -> PreferencesResponse
```


update user preferences.


## Classes

### `PreferencesResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/preferences.py#L23)


user preferences response model.


### `PreferencesUpdate` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/preferences.py#L42)


user preferences update model.


**Methods:**

#### `validate_support_url` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/preferences.py#L58)

```python
validate_support_url(cls, v: str | None) -> str | None
```

validate support url: empty, 'atprotofans', or https:// URL.

