# pdsx guide for plyr.fm

[pdsx](https://github.com/zzstoatzz/pdsx) is a CLI tool and MCP server for ATProto record operations. this guide covers how to use it for inspecting and managing plyr.fm track records.

## overview

pdsx provides two ways to interact with ATProto records:

1. **MCP server** (recommended) - integrated into claude code, provides direct access through model context protocol
2. **CLI** - useful for scripts and automation

**for most plyr.fm operations, use the MCP server**. it automatically handles PDS resolution, provides structured results, and integrates seamlessly with claude code. the CLI is primarily for scripts and one-off commands.

## MCP server (primary method)

the pdsx MCP server is integrated into claude code and provides direct access to:
- listing records in collections
- reading individual records by URI
- creating, updating, and deleting records (authenticated operations)
- automatic PDS URL resolution from handles or DIDs

### authentication

some operations require authentication:
- **read operations** with `repo` parameter: no auth needed (reads public data)
- **read operations** without `repo`: auth needed (reads your own records)
- **write operations** (create, update, delete): always require auth

the mcp automatically resolves PDS URLs from handles or DIDs, so you typically don't need to specify PDS URLs explicitly.

### listing records

list all tracks for a user:

```json
mcp__pdsx__list_records({
  "collection": "fm.plyr.track",
  "repo": "zzstoatzz.io",
  "limit": 50
})
```

or using a DID:

```json
mcp__pdsx__list_records({
  "collection": "fm.plyr.track",
  "repo": "did:plc:xbtmt2zjwlrfegqvch7fboei",
  "limit": 50
})
```

returns a list of records with `uri`, `cid`, and cleaned `value` data.

**parameters**:
- `collection` (required): the collection to list (e.g., `fm.plyr.track`)
- `repo` (optional): handle or DID to read from. if not provided, reads your own records (requires auth)
- `limit` (optional): max records to return (default 50)
- `cursor` (optional): pagination cursor from previous response

### reading records

get a specific record by URI:

```json
mcp__pdsx__get_record({
  "uri": "at://did:plc:xbtmt2zjwlrfegqvch7fboei/fm.plyr.track/3m5a4wg7i352p"
})
```

or using shorthand when authenticated:

```json
mcp__pdsx__get_record({
  "uri": "fm.plyr.track/3m5a4wg7i352p"
})
```

returns a record with `uri`, `cid`, and cleaned `value` containing fields like `title`, `artist`, `audioUrl`, `fileType`, `album`, `features`, `imageUrl`, `createdAt`.

### filtering results

the `list_records` and `get_record` tools support a `_filter` parameter with jmespath:

```json
mcp__pdsx__list_records({
  "collection": "fm.plyr.track",
  "repo": "zzstoatzz.io",
  "_filter": "[*].uri"
})
```

see https://jmespath.org for full syntax.

### write operations

create, update, and delete records (all require authentication):

```json
mcp__pdsx__create_record({
  "collection": "fm.plyr.track",
  "record": {"title": "my track", "artist": "artist name", "audioUrl": "https://...", "fileType": "mp3"}
})

mcp__pdsx__update_record({
  "uri": "fm.plyr.track/abc123",
  "updates": {"album": "new album name"}
})

mcp__pdsx__delete_record({
  "uri": "fm.plyr.track/abc123"
})
```

## CLI (for scripts and automation)

the CLI provides the same functionality as the MCP but is better suited for scripts and one-off commands.

### installation

```bash
# use uvx for one-off commands (auto-updates)
uvx pdsx --version

# or install globally
uv tool install pdsx
```

### authentication vs unauthenticated reads

**unauthenticated reads** (public data) - use `-r` flag with handle or DID:

```bash
# read from bluesky PDS (default)
uvx pdsx -r zzstoatzzdevlog.bsky.social ls fm.plyr.track

# read from custom PDS (requires --pds flag)
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track
```

**important**: unauthenticated reads assume bsky.social PDS by default. for custom PDS instances (like zzstoatzz.io), you **must** provide `--pds` explicitly.

**authenticated operations** (write access) - use `--handle` and `--password` flags:

```bash
# for bluesky users (auto-discovers PDS)
uvx pdsx --handle you.bsky.social --password xxxx-xxxx ls fm.plyr.track

# creates records, updates, etc.
uvx pdsx --handle you.bsky.social --password xxxx-xxxx create fm.plyr.track title='test'
```

**note**: authenticated operations auto-discover PDS from handle, so you don't need `--pds` flag when using `--handle` and `--password`.

### common CLI operations

**list all tracks for a user:**

```bash
# unauthenticated read (public)
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track

# authenticated (shows your own tracks)
uvx pdsx --handle zzstoatzzdevlog.bsky.social --password "$ATPROTO_PASSWORD" ls fm.plyr.track
```

**inspect a specific track:**

track URIs have the format: `at://did/collection/rkey`

```bash
# get full record details
uvx pdsx --pds https://pds.zzstoatzz.io cat at://did:plc:xbtmt2zjwlrfegqvch7fboei/fm.plyr.track/3m5a4wg7i352p
```

**find tracks with specific criteria:**

use shell tools to filter:

```bash
# find tracks with images
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | grep imageUrl

# find tracks with features
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | grep features

# count total tracks
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | head -1
```

### credential management

store credentials in `.env`:

```bash
# dev log account (test operations)
ATPROTO_HANDLE=zzstoatzzdevlog.bsky.social
ATPROTO_PASSWORD=your-app-password

# main account (backfills, migrations)
ATPROTO_MAIN_HANDLE=zzstoatzz.io
ATPROTO_MAIN_PASSWORD=your-app-password
```

use in scripts:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )

    handle: str = Field(validation_alias="ATPROTO_HANDLE")
    password: str = Field(validation_alias="ATPROTO_PASSWORD")
```

## common workflows

### debugging orphaned/stale records

**scenario 1: tracks in database but no ATProto records**

1. check what records exist on PDS (use MCP or CLI):
   ```json
   mcp__pdsx__list_records({
     "collection": "fm.plyr.track",
     "repo": "zzstoatzz.io"
   })
   ```
   or:
   ```bash
   uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track
   ```

2. query database for tracks with that artist_did (use neon MCP):
   ```json
   mcp__neon__run_sql({
     "projectId": "muddy-flower-98795112",
     "sql": "SELECT id, title, atproto_record_uri FROM tracks WHERE artist_did = 'did:plc:xbtmt2zjwlrfegqvch7fboei'"
   })
   ```

3. compare - any tracks in DB without `atproto_record_uri` are orphaned

**scenario 2: stale URIs pointing to old namespace**

check for old namespace records (should be none in `fm.plyr.track`):

```bash
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls app.relay.track
```

if you find any, those are stale and should be migrated.

**scenario 3: verify record contents match database**

get a specific record and compare with database:

```json
mcp__pdsx__get_record({
  "uri": "at://did:plc:xbtmt2zjwlrfegqvch7fboei/fm.plyr.track/3m5a4wg7i352p"
})
```

or:

```bash
uvx pdsx --pds https://pds.zzstoatzz.io cat at://did:plc:xbtmt2zjwlrfegqvch7fboei/fm.plyr.track/3m5a4wg7i352p
```

compare `imageUrl`, `features`, `album`, etc. with database values. mismatches indicate failed updates.

### verify backfill success

after running `scripts/backfill_atproto_records.py`:

1. check how many records were created (use MCP):
   ```json
   mcp__pdsx__list_records({
     "collection": "fm.plyr.track",
     "repo": "zzstoatzz.io"
   })
   ```

2. verify specific tracks have correct data by filtering the results

3. confirm imageUrl present for tracks that should have it by inspecting individual records

or with CLI:

```bash
# check record count
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | head -1

# verify specific tracks
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | grep -E "webhook|geese"

# confirm imageUrl present
uvx pdsx --pds https://pds.zzstoatzz.io cat at://did:plc:xbtmt2zjwlrfegqvch7fboei/fm.plyr.track/3m5a4wg7i352p | grep imageUrl
```

### compare database vs atproto records

when debugging sync issues:

1. get record count from PDS (count the results from `list_records` or CLI output)

2. get record count from database (use neon MCP):
   ```json
   mcp__neon__run_sql({
     "projectId": "muddy-flower-98795112",
     "sql": "SELECT COUNT(*) FROM tracks WHERE artist_did = 'did:plc:xbtmt2zjwlrfegqvch7fboei' AND atproto_record_uri IS NOT NULL"
   })
   ```

3. if counts don't match, list all records to find missing ones

### clean up test records

with CLI:

```bash
# list test records to get their rkeys
uvx pdsx --handle zzstoatzzdevlog.bsky.social --password "$ATPROTO_PASSWORD" ls fm.plyr.track | grep test

# delete by URI
uvx pdsx --handle zzstoatzzdevlog.bsky.social --password "$ATPROTO_PASSWORD" rm at://did:plc:pmz4rx66ijxzke6ka5o3owmg/fm.plyr.track/3m57zgph47z2w
```

or with MCP:

```json
mcp__pdsx__delete_record({
  "uri": "fm.plyr.track/3m57zgph47z2w"
})
```

## atproto namespace

plyr.fm uses environment-specific namespaces configured via `ATPROTO_APP_NAMESPACE`:
- **dev**: `fm.plyr.dev` → track collection: `fm.plyr.dev.track`
- **staging**: `fm.plyr.stg` → track collection: `fm.plyr.stg.track`
- **prod**: `fm.plyr` → track collection: `fm.plyr.track`

**critical**: never use bluesky lexicons (`app.bsky.*`) for plyr.fm records. always use `fm.plyr.*` namespace.

when using pdsx with dev environment, query `fm.plyr.dev.track`, not `fm.plyr.track`.

## troubleshooting

### authentication errors (MCP)

if you get authentication errors for read operations:
- ensure `repo` parameter is provided for public reads
- for reading your own records without `repo`, ensure MCP is configured with auth headers

### "BadJwtSignature" errors (CLI)

this usually means you're querying the wrong PDS for the user's DID.

**root cause**: each user's ATProto identity (DID) is hosted on a specific PDS. trying to read records from the wrong PDS results in signature errors.

**solution**: the mcp automatically resolves PDS URLs. for CLI, resolve the user's PDS URL from their DID using the [PLC directory](../backend/atproto-identity.md):

```bash
# resolve PDS for a DID
curl -s "https://plc.directory/did:plc:xbtmt2zjwlrfegqvch7fboei" | jq -r '.service[] | select(.type == "AtprotoPersonalDataServer") | .serviceEndpoint'
# output: https://pds.zzstoatzz.io

# then use that PDS with pdsx
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track
```

**quick reference**:
- bluesky users: usually `https://bsky.social` (default, no flag needed)
- custom PDS users: must resolve via PLC directory and provide `--pds` flag

### "could not find repo" errors

this means:
- DID/handle doesn't exist on the queried PDS
- using wrong PDS (bsky.social vs custom)

solution: verify handle/DID is correct. the mcp automatically resolves PDS URLs, so this is usually a handle/DID issue. for CLI, ensure correct `--pds` flag.

### empty results when you expect records

check:
1. are you querying the right PDS? (mcp auto-resolves, CLI requires `--pds` flag for custom PDS)
2. are you querying the right collection? (`fm.plyr.track` not `app.relay.track`)
3. does the user actually have records? (check database with neon MCP)
4. are you using the correct namespace for the environment? (dev vs staging vs prod)

### known CLI limitations

1. **custom PDS requires explicit flag for unauthenticated reads** ([#30](https://github.com/zzstoatzz/pdsx/issues/30)):
   ```bash
   # currently won't work - defaults to bsky.social
   uvx pdsx -r zzstoatzz.io ls fm.plyr.track

   # workaround: use explicit --pds flag
   uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track
   ```

2. **cat command requires full AT-URI format** ([#31](https://github.com/zzstoatzz/pdsx/issues/31)):
   ```bash
   # currently required
   uvx pdsx cat at://did:plc:abc/fm.plyr.track/xyz

   # shorthand not yet supported
   uvx pdsx cat fm.plyr.track/xyz
   ```

3. **flag order matters**: `-r`, `--handle`, `--password`, `--pds` must come BEFORE the command (ls, cat, etc.)
   ```bash
   # correct
   uvx pdsx -r zzstoatzz.io ls fm.plyr.track

   # wrong
   uvx pdsx ls -r zzstoatzz.io fm.plyr.track
   ```

## related tools

- **neon MCP**: for querying the database (see docs/tools/neon.md)
- **pdsx CLI**: for script automation (see scripts/)
- **PLC directory**: for resolving PDS URLs from DIDs (see docs/backend/atproto-identity.md)

## references

- pdsx repository: https://github.com/zzstoatzz/pdsx
- pdsx documentation: https://pdsx.zzstoatzz.io
- pdsx releases: https://github.com/zzstoatzz/pdsx/releases
- ATProto specs: https://atproto.com
- plyr.fm track schema: `src/backend/_internal/atproto/records.py:build_track_record`
