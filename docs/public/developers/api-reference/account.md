---
title: account
sidebarTitle: account
---

# `backend.api.account`


account management endpoints.

## Functions

### `delete_account` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/account.py#L54)

```python
delete_account(request: AccountDeleteRequest, db: Annotated[AsyncSession, Depends(get_db)], session: Session = Depends(require_auth)) -> AccountDeleteResponse
```


remove local account rows and attempt unreferenced media cleanup.

:::caution[staging cleanup]
protected Space sources, retained revisions and private copies are covered on
staging by [#2238](https://github.com/zzstoatzz/plyr.fm/pull/2238); production promotion is pending. shared media and active
uploads are retained, and remote cleanup is best-effort.
:::

this removes local data for:

- tracks and albums
- all likes given by the user
- all comments made by the user
- user preferences
- all sessions
- queue state
- jobs

`delete_atproto_records=false` keeps user-owned PDS records and sources.
When true, staging also attempts unreferenced protected source and member-private
metadata deletion using the owner session. Deleted database rows do not prove
remote objects were erased. See [publishing access](/developers/publishing/).


### `accept_terms` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/account.py#L211)

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

