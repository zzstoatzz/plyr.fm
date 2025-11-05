# configuration

relay uses nested pydantic settings for configuration management, following a pattern similar to prefect.

## settings structure

settings are organized into logical sections:

```python
from relay.config import settings

# application settings
settings.app.name                              # "relay"
settings.app.port                              # 8001 (from PORT)
settings.app.debug                             # false
settings.app.broadcast_channel_prefix          # "relay"
settings.app.canonical_host                    # "relay.zzstoatzz.io"
settings.app.canonical_url                     # computed: https://relay.zzstoatzz.io

# frontend settings
settings.frontend.url                          # from FRONTEND_URL
settings.frontend.cors_origin_regex            # from FRONTEND_CORS_ORIGIN_REGEX (optional)
settings.frontend.resolved_cors_origin_regex   # computed: defaults to relay-4i6.pages.dev pattern

# database settings
settings.database.url                          # from DATABASE_URL

# redis settings
settings.redis.url                             # from REDIS_URL

# storage settings (cloudflare r2)
settings.storage.backend                       # from STORAGE_BACKEND
settings.storage.r2_bucket                     # from R2_BUCKET
settings.storage.r2_endpoint_url               # from R2_ENDPOINT_URL
settings.storage.r2_public_bucket_url          # from R2_PUBLIC_BUCKET_URL
settings.storage.aws_access_key_id             # from AWS_ACCESS_KEY_ID
settings.storage.aws_secret_access_key         # from AWS_SECRET_ACCESS_KEY

# atproto settings
settings.atproto.pds_url                       # from ATPROTO_PDS_URL
settings.atproto.client_id                     # from ATPROTO_CLIENT_ID
settings.atproto.redirect_uri                  # from ATPROTO_REDIRECT_URI
settings.atproto.app_namespace                 # from ATPROTO_APP_NAMESPACE
settings.atproto.oauth_encryption_key          # from OAUTH_ENCRYPTION_KEY
settings.atproto.track_collection              # computed: "{namespace}.track"
settings.atproto.resolved_scope                # computed: "atproto repo:{collection}"

# observability settings (pydantic logfire)
settings.observability.enabled                 # from LOGFIRE_ENABLED
settings.observability.write_token             # from LOGFIRE_WRITE_TOKEN
settings.observability.environment             # from LOGFIRE_ENVIRONMENT

# notification settings
settings.notify.enabled                        # from NOTIFY_ENABLED
settings.notify.recipient_handle               # from NOTIFY_RECIPIENT_HANDLE
settings.notify.bot.handle                     # from NOTIFY_BOT_HANDLE
settings.notify.bot.password                   # from NOTIFY_BOT_PASSWORD
```

## environment variables

all settings can be configured via environment variables. the variable names match the flat structure used in `.env`:

### required

```bash
# database
DATABASE_URL=postgresql+psycopg://user:pass@host/db

# oauth (register at https://oauthclientregistry.bsky.app/)
ATPROTO_CLIENT_ID=https://your-domain.com/client-metadata.json
ATPROTO_REDIRECT_URI=https://your-domain.com/auth/callback
OAUTH_ENCRYPTION_KEY=<base64-encoded-32-byte-key>

# storage
STORAGE_BACKEND=r2  # or "filesystem"
R2_BUCKET=your-bucket
R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com
R2_PUBLIC_BUCKET_URL=https://pub-xxx.r2.dev
AWS_ACCESS_KEY_ID=your-r2-access-key
AWS_SECRET_ACCESS_KEY=your-r2-secret
```

### optional

```bash
# app
PORT=8001
FRONTEND_URL=http://localhost:5173

# observability
LOGFIRE_ENABLED=true
LOGFIRE_WRITE_TOKEN=pylf_xxx

# notifications (bluesky DMs)
NOTIFY_ENABLED=true
NOTIFY_RECIPIENT_HANDLE=your.handle
NOTIFY_BOT_HANDLE=bot.handle
NOTIFY_BOT_PASSWORD=app-password
```

## computed fields

some settings are computed from other values:

### `settings.app.canonical_url`

automatically determines the protocol based on host:
- `localhost` or `127.0.0.1` → `http://`
- anything else → `https://`

can be overridden with `canonical_url_override` if needed.

### `settings.frontend.resolved_cors_origin_regex`

constructs the CORS origin regex pattern:
```python
# default: allows localhost + relay-4i6.pages.dev (including preview deployments)
r"^(https://([a-z0-9]+\.)?relay-4i6\.pages\.dev|http://localhost:5173)$"
```

can be overridden with `FRONTEND_CORS_ORIGIN_REGEX` if needed.

### `settings.atproto.track_collection`

constructs the atproto collection name from the namespace:
```python
f"{settings.atproto.app_namespace}.track"
# default: "app.relay.track"
```

### `settings.atproto.resolved_scope`

constructs the oauth scope from the collection:
```python
f"atproto repo:{settings.atproto.track_collection}"
# default: "atproto repo:app.relay.track"
```

can be overridden with `ATPROTO_SCOPE_OVERRIDE` if needed.

## changing atproto namespace

to migrate to a relay-owned lexicon (issue #55), set:

```bash
ATPROTO_APP_NAMESPACE=io.zzstoatzz.relay
```

this automatically updates:
- `track_collection` → `"io.zzstoatzz.relay.track"`
- `resolved_scope` → `"atproto repo:io.zzstoatzz.relay.track"`

## usage in code

```python
from relay.config import settings

# access nested settings
database_url = settings.database.url
r2_bucket = settings.storage.r2_bucket
track_collection = settings.atproto.track_collection

# computed properties work seamlessly
canonical_url = settings.app.canonical_url
oauth_scope = settings.atproto.resolved_scope
```

## testing

tests automatically override settings with local defaults via `tests/__init__.py`:

```python
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost/relay")
os.environ.setdefault("LOGFIRE_ENABLED", "false")
os.environ.setdefault("NOTIFY_ENABLED", "false")
```

individual tests can override settings using pytest fixtures:

```python
def test_something(monkeypatch):
    monkeypatch.setenv("PORT", "9100")
    monkeypatch.setenv("ATPROTO_APP_NAMESPACE", "com.example.test")

    settings = Settings()  # reload with new env vars
    assert settings.app.port == 9100
    assert settings.atproto.track_collection == "com.example.test.track"
```

## migration from flat settings

the refactor maintains backward compatibility with all existing environment variables:

| old (flat)              | new (nested)                    | env var           |
|-------------------------|---------------------------------|-------------------|
| `settings.port`         | `settings.app.port`             | `PORT`            |
| `settings.database_url` | `settings.database.url`         | `DATABASE_URL`    |
| `settings.r2_bucket`    | `settings.storage.r2_bucket`    | `R2_BUCKET`       |
| `settings.atproto_scope`| `settings.atproto.resolved_scope`| (computed)       |

all code has been updated to use the nested structure.

## design

the settings design follows the prefect pattern:
- each section extends `RelaySettingsSection` (a `BaseSettings` subclass)
- sections are composed in the root `Settings` class
- environment variables map directly to field names
- computed fields derive values from other settings
- type hints ensure correct types at runtime

see `src/relay/config.py` for implementation details.
