---
title: account
sidebarTitle: account
---

# `backend.api.account`


account management endpoints.

## Functions

### `delete_account` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/account.py#L48)

```python
delete_account(request: AccountDeleteRequest, db: Annotated[AsyncSession, Depends(get_db)], session: Session = Depends(require_auth)) -> AccountDeleteResponse
```


permanently delete user account and all associated data.

this deletes:
- all tracks (audio files and cover images from R2)
- all albums (cover images from R2)
- all likes given by the user
- all comments made by the user
- user preferences
- all sessions
- queue state
- jobs

optionally deletes ATProto records from user's PDS if requested.


### `accept_terms` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/account.py#L232)

```python
accept_terms(db: Annotated[AsyncSession, Depends(get_db)], session: Session = Depends(require_auth)) -> TermsAcceptanceResponse
```


accept terms of service. records timestamp of acceptance.


## Classes

### `AccountDeleteRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/account.py#L34)


request body for account deletion.


### `AccountDeleteResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/account.py#L41)


response body for account deletion.


### `TermsAcceptanceResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/account.py#L225)


response after accepting terms.

