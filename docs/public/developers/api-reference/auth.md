---
title: auth
sidebarTitle: auth
---

# `backend.api.auth`


authentication api endpoints.

## Functions

### `get_pds_options` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L108)

```python
get_pds_options() -> PdsOptionsResponse
```


get available PDS options for account creation.

returns the list of recommended PDS hosts where users can create
new ATProto accounts. this is used by the frontend login page to
show the "create account" option.


### `start_login` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L132)

```python
start_login(request: Request, handle: str | None = None, pds_url: str | None = None) -> RedirectResponse
```


start OAuth flow for login or account creation.

for login: provide `handle` to authenticate with an existing account.
for account creation: provide `pds_url` to create a new account on that PDS.

exactly one of `handle` or `pds_url` must be provided.


### `oauth_callback` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L172)

```python
oauth_callback(code: Annotated[str, Query()], state: Annotated[str, Query()], iss: Annotated[str, Query()]) -> RedirectResponse
```


handle OAuth callback and create session.

returns exchange token in URL which frontend will exchange for session_id.
exchange token is short-lived (60s) and one-time use for security.

handles four flow types based on pending state:
1. developer token flow - creates dev token session, redirects with dev_token=true
2. scope upgrade flow - replaces old session with new one, redirects to settings
3. add account flow - creates session in existing group, redirects to portal
4. regular login flow - creates session, redirects to portal or profile setup


### `exchange_token` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L319)

```python
exchange_token(request: Request, exchange_request: ExchangeTokenRequest, response: Response) -> ExchangeTokenResponse
```


exchange one-time token for session_id.

frontend calls this immediately after OAuth callback to securely
exchange the short-lived token for the actual session_id.

for browser requests: sets HttpOnly cookie and still returns session_id in response
for SDK/CLI clients: only returns session_id in response (no cookie)
for dev token exchanges: returns session_id but does NOT set cookie


### `logout` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L370)

```python
logout(session: Session = Depends(require_auth), switch_to: Annotated[str | None, Query(description='DID to switch to after logout')] = None, db = Depends(get_db)) -> JSONResponse
```


logout current user.

if switch_to is provided and valid, deletes current session and switches
to the specified account. otherwise, fully logs out.


### `get_current_user` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L436)

```python
get_current_user(session: Session = Depends(require_auth), db = Depends(get_db)) -> CurrentUserResponse
```


get current authenticated user with linked accounts.


### `get_developer_tokens` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L471)

```python
get_developer_tokens(session: Session = Depends(require_auth)) -> DeveloperTokenListResponse
```


list all developer tokens for the current user.


### `delete_developer_token` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L491)

```python
delete_developer_token(token_prefix: str, session: Session = Depends(require_auth)) -> JSONResponse
```


revoke a developer token by its prefix (first 8 chars of session_id).


### `start_developer_token_flow` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L531)

```python
start_developer_token_flow(request: Request, body: DevTokenStartRequest, session: Session = Depends(require_auth)) -> DevTokenStartResponse
```


start OAuth flow to create a developer token with its own credentials.

this initiates a new OAuth authorization flow. the user will be redirected
to authorize, and on callback a dev token with independent OAuth credentials
will be created. this ensures dev tokens don't become stale when browser
sessions refresh their tokens.

returns the authorization URL that the frontend should redirect to.


### `start_scope_upgrade_flow` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L592)

```python
start_scope_upgrade_flow(request: Request, body: ScopeUpgradeStartRequest, session: Session = Depends(require_auth)) -> ScopeUpgradeStartResponse
```


start OAuth flow to upgrade session scopes.

this initiates a new OAuth authorization flow with expanded scopes.
the user will be redirected to authorize, and on callback the old session
will be replaced with a new session that has the requested scopes.

use this when a user enables a feature that requires additional OAuth scopes
(e.g., enabling teal.fm scrobbling which needs fm.teal.alpha.* scopes).

returns the authorization URL that the frontend should redirect to.


### `start_add_account_flow` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L644)

```python
start_add_account_flow(request: Request, body: AddAccountStartRequest, session: Session = Depends(require_auth)) -> AddAccountStartResponse
```


start OAuth flow to add another account to the session group.

the user must provide the handle of the account they want to add.
this initiates a new OAuth authorization flow with prompt=login to force
fresh authentication. the new account will be linked to the same session
group as the current account, enabling quick switching between accounts.

returns the authorization URL that the frontend should redirect to.


### `switch_account` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L694)

```python
switch_account(body: SwitchAccountRequest, response: Response, session: Session = Depends(require_auth), db = Depends(get_db)) -> SwitchAccountResponse
```


switch to a different account in the session group.

switches the active account within the session group. the cookie is updated
to point to the new session, and the old session is marked inactive.

returns the new active account's info.


### `logout_all` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L756)

```python
logout_all(session: Session = Depends(require_auth), db = Depends(get_db)) -> JSONResponse
```


logout all accounts in the session group.

removes all sessions in the group and clears the cookie.


## Classes

### `LinkedAccountResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L52)


account info for account switcher UI.


### `CurrentUserResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L60)


response model for current user endpoint.


### `DeveloperTokenInfo` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L69)


info about a developer token (without the actual token).


**Methods:**

#### `truncate_session_id` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L79)

```python
truncate_session_id(cls, v: str) -> str
```

truncate to 8-char prefix for safe display.


### `DeveloperTokenListResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L84)


response model for listing developer tokens.


### `PdsOption` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L90)


a PDS option for account creation.


### `PdsOptionsResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L100)


response model for PDS options endpoint.


### `ExchangeTokenRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L305)


request model for exchanging token for session_id.


### `ExchangeTokenResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L311)


response model for exchange token endpoint.


### `DevTokenStartRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L516)


request model for starting developer token OAuth flow.


### `DevTokenStartResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L523)


response model with OAuth authorization URL.


### `ScopeUpgradeStartRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L577)


request model for starting scope upgrade OAuth flow.


### `ScopeUpgradeStartResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L584)


response model with OAuth authorization URL.


### `AddAccountStartRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L630)


request model for starting add-account flow.


### `AddAccountStartResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L636)


response model with OAuth authorization URL for adding account.


### `SwitchAccountRequest` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L679)


request model for switching to a different account.


### `SwitchAccountResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/auth.py#L685)


response model after switching accounts.

