# configuration

plyr.fm uses nested pydantic settings for configuration management, following a pattern similar to prefect.

## settings structure

settings are organized into logical sections:

```python
from backend.config import settings

# application settings
settings.app.name                              # "plyr"
settings.app.port                              # 8001 (from PORT)
settings.app.debug                             # false
settings.app.broadcast_channel_prefix          # "plyr"
settings.app.canonical_host                    # "plyr.fm"
settings.app.canonical_url                     # computed: https://plyr.fm

# frontend settings
settings.frontend.url                          # from FRONTEND_URL
settings.frontend.cors_origin_regex            # from FRONTEND_CORS_ORIGIN_REGEX (optional)
settings.frontend.resolved_cors_origin_regex   # computed: defaults to relay-4i6.pages.dev pattern

# database settings
settings.database.url                          # from DATABASE_URL

# storage settings (cloudflare r2)
settings.storage.backend                       # from STORAGE_BACKEND
settings.storage.r2_bucket                     # from R2_BUCKET (audio files)
settings.storage.r2_image_bucket               # from R2_IMAGE_BUCKET (image files)
settings.storage.r2_endpoint_url               # from R2_ENDPOINT_URL
settings.storage.r2_public_bucket_url          # from R2_PUBLIC_BUCKET_URL (audio files)
settings.storage.r2_public_image_bucket_url    # from R2_PUBLIC_IMAGE_BUCKET_URL (image files)
settings.storage.aws_access_key_id             # from AWS_ACCESS_KEY_ID
settings.storage.aws_secret_access_key         # from AWS_SECRET_ACCESS_KEY

# atproto settings
settings.atproto.pds_url                       # from ATPROTO_PDS_URL
settings.atproto.client_id                     # from ATPROTO_CLIENT_ID
settings.atproto.client_secret                 # from ATPROTO_CLIENT_SECRET
settings.atproto.redirect_uri                  # from ATPROTO_REDIRECT_URI
settings.atproto.app_namespace                 # from ATPROTO_APP_NAMESPACE
settings.atproto.old_app_namespace             # from ATPROTO_OLD_APP_NAMESPACE (optional)
settings.atproto.oauth_encryption_key          # from OAUTH_ENCRYPTION_KEY
settings.atproto.track_collection              # computed: "{namespace}.track"
settings.atproto.old_track_collection          # computed: "{old_namespace}.track" (if set)
settings.atproto.resolved_scope                # computed: "atproto repo:{collections}"

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

# oauth (uses client metadata discovery - no registration required)
ATPROTO_CLIENT_ID=https://your-domain.com/oauth-client-metadata.json
ATPROTO_CLIENT_SECRET=<optional-client-secret>
ATPROTO_REDIRECT_URI=https://your-domain.com/auth/callback
OAUTH_ENCRYPTION_KEY=<base64-encoded-32-byte-key>

# storage
STORAGE_BACKEND=r2  # or "filesystem"
R2_BUCKET=your-audio-bucket
R2_IMAGE_BUCKET=your-image-bucket
R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com
R2_PUBLIC_BUCKET_URL=https://pub-xxx.r2.dev  # for audio files
R2_PUBLIC_IMAGE_BUCKET_URL=https://pub-xxx.r2.dev  # for image files
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
# default: "fm.plyr.track"
```

### `settings.atproto.resolved_scope`

constructs the oauth scope from the collection(s):
```python
# base scopes: our track collection + our like collection
scopes = [
    f"repo:{settings.atproto.track_collection}",
    f"repo:{settings.atproto.app_namespace}.like",
]

# if we have an old namespace, add old track collection too
if settings.atproto.old_app_namespace:
    scopes.append(f"repo:{settings.atproto.old_track_collection}")

return f"atproto {' '.join(scopes)}"
# default: "atproto repo:fm.plyr.track repo:fm.plyr.like"
```

can be overridden with `ATPROTO_SCOPE_OVERRIDE` if needed.

## atproto namespace

plyr.fm uses `fm.plyr` as the ATProto namespace:

```bash
ATPROTO_APP_NAMESPACE=fm.plyr  # default
```

this defines the collections:
- `track_collection` → `"fm.plyr.track"`
- `like_collection` → `"fm.plyr.like"` (implicit)
- `resolved_scope` → `"atproto repo:fm.plyr.track repo:fm.plyr.like"`

### environment-specific namespaces

each environment uses a separate namespace to prevent test data from polluting production collections:

**development (local):**
```bash
ATPROTO_APP_NAMESPACE=fm.plyr.dev
```
- `track_collection` → `"fm.plyr.dev.track"`
- `like_collection` → `"fm.plyr.dev.like"`
- records written to dev-specific collections on user's PDS

**staging:**
```bash
ATPROTO_APP_NAMESPACE=fm.plyr.stg
```
- `track_collection` → `"fm.plyr.stg.track"`
- `like_collection` → `"fm.plyr.stg.like"`
- records written to staging-specific collections on user's PDS

**production:**
```bash
ATPROTO_APP_NAMESPACE=fm.plyr
```
- `track_collection` → `"fm.plyr.track"`
- `like_collection` → `"fm.plyr.like"`
- records written to production collections on user's PDS

this separation ensures that:
- test tracks/likes created in dev/staging don't pollute production collections
- OAuth scopes are environment-specific
- database and ATProto records stay aligned within each environment

see `docs/deployment/environments.md` for more details on environment configuration.

### namespace migration

optionally supports migration from an old namespace:

```bash
ATPROTO_OLD_APP_NAMESPACE=app.relay  # optional, for migration
```

when set, OAuth scopes will include both old and new namespaces:
- `old_track_collection` → `"app.relay.track"`
- `resolved_scope` → `"atproto repo:fm.plyr.track repo:fm.plyr.like repo:app.relay.track"`

## usage in code

```python
from backend.config import settings

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
from backend.config import Settings

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
| `settings.atproto_scope`| `settings.atproto.resolved_scope`| (computed)        |

all code has been updated to use the nested structure.

## design

the settings design follows the prefect pattern:
- each section extends `BaseSettings` subclass
- sections are composed in the root `Settings` class
- environment variables map directly to field names
- computed fields derive values from other settings
- type hints ensure correct types at runtime

see `src/backend/config.py` for implementation details.
