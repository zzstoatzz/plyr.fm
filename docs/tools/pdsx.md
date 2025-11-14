# pdsx guide for plyr.fm

[pdsx](https://github.com/zzstoatzz/pdsx) is a CLI tool for ATProto record operations. this guide covers how to use it for inspecting and managing plyr.fm track records.

## installation

```bash
# use uvx for one-off commands (auto-updates)
uvx pdsx --version

# or install globally
uv tool install pdsx
```

## authentication vs unauthenticated reads

### unauthenticated reads (public data)

use `-r` flag with handle or DID:

```bash
# read from bluesky PDS (default)
uvx pdsx -r zzstoatzzdevlog.bsky.social ls fm.plyr.track

# read from custom PDS (requires --pds flag)
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track
```

**NOTE** pds.zzstoatzz.io is JUST AN EXAMPLE of a custom PDS for the specific case of zzstoatzz.io. each user has their own PDS URL, whether bsky.social or custom.

**important**: unauthenticated reads assume bsky.social PDS by default. for custom PDS instances (like zzstoatzz.io), you **must** provide `--pds` explicitly.

### authenticated operations (write access)

use `--handle` and `--password` flags:

```bash
# for bluesky users (auto-discovers PDS)
uvx pdsx --handle you.bsky.social --password xxxx-xxxx ls fm.plyr.track

# creates records, updates, etc.
uvx pdsx --handle you.bsky.social --password xxxx-xxxx create fm.plyr.track title='test'
```

**note**: authenticated operations auto-discover PDS from handle, so you don't need `--pds` flag when using `--handle` and `--password`.

## common operations

### list all tracks for a user

```bash
# unauthenticated read (public)
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track

# authenticated (shows your own tracks)
uvx pdsx --handle zzstoatzzdevlog.bsky.social --password "$ATPROTO_PASSWORD" ls fm.plyr.track
```

### inspect a specific track

track URIs have the format: `at://did/collection/rkey`

```bash
# get full record details
uvx pdsx --pds https://pds.zzstoatzz.io cat at://did:plc:xbtmt2zjwlrfegqvch7fboei/fm.plyr.track/3m5a4wg7i352p
```

### find tracks with specific criteria

use shell tools to filter:

```bash
# find tracks with images
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | grep imageUrl

# find tracks with features
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | grep features

# count total tracks
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | head -1
```

## debugging orphaned/stale records

### scenario 1: tracks in database but no ATProto records

```bash
# 1. check what records exist on PDS
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track

# 2. query database for tracks with that artist_did
# (use neon MCP or direct psql)

# 3. compare - any tracks in DB without atproto_record_uri are orphaned
```

### scenario 2: stale URIs pointing to old namespace

```bash
# check for old namespace records (should be none in fm.plyr.track)
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls app.relay.track

# if you find any, those are stale and should be migrated
```

### scenario 3: verify record contents match database

```bash
# get a specific record
uvx pdsx --pds https://pds.zzstoatzz.io cat at://did:plc:xbtmt2zjwlrfegqvch7fboei/fm.plyr.track/3m5a4wg7i352p

# compare imageUrl, features, album, etc. with database values
# mismatches indicate failed updates
```

## atproto namespace

all plyr.fm records use the unified `fm.plyr.track` namespace across all environments (dev, staging, prod). there are no environment-specific namespaces.

**critical**: never use bluesky lexicons (app.bsky.*) for plyr.fm records. always use fm.plyr.* namespace.

## credential management

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

## workflow examples

### verify backfill success

after running `scripts/backfill_atproto_records.py`:

```bash
# 1. check how many records were created
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | head -1

# 2. verify specific tracks have correct data
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | grep -E "webhook|geese"

# 3. confirm imageUrl present for tracks that should have it
uvx pdsx --pds https://pds.zzstoatzz.io cat at://did:plc:xbtmt2zjwlrfegqvch7fboei/fm.plyr.track/3m5a4wg7i352p | grep imageUrl
```

### clean up test records

```bash
# list test records to get their rkeys
uvx pdsx --handle zzstoatzzdevlog.bsky.social --password "$ATPROTO_PASSWORD" ls fm.plyr.track | grep test

# delete by URI
uvx pdsx --handle zzstoatzzdevlog.bsky.social --password "$ATPROTO_PASSWORD" rm at://did:plc:pmz4rx66ijxzke6ka5o3owmg/fm.plyr.track/3m57zgph47z2w
```

### compare database vs atproto records

when debugging sync issues, you need to compare both sources:

```bash
# 1. get record count from PDS
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | head -1
# output: "found 15 records"

# 2. get record count from database (use neon MCP)
# SELECT COUNT(*) FROM tracks WHERE artist_did = 'did:plc:xbtmt2zjwlrfegqvch7fboei'

# 3. if counts don't match, list all records to find missing ones
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track | grep -E "rkey|title"
```

## known limitations

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

## troubleshooting

### "BadJwtSignature" errors

this usually means you're querying the wrong PDS for the user's DID.

**root cause**: each user's ATProto identity (DID) is hosted on a specific PDS. trying to read records from the wrong PDS results in signature errors.

**solution**: use the --help flag, and if it doesn't explain that pdsx can resolve the users PDS from their DID, then open an upstream issue but you can resolve the user's PDS URL from their DID using the [PLC directory](../backend/atproto-identity.md).

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

solution: verify handle and add correct `--pds` flag.

### empty results when you expect records

check:
1. are you querying the right PDS? (`--pds` flag)
2. are you querying the right collection? (`fm.plyr.track` not `app.relay.track`)
3. does the user actually have records? (check database)

## references

- pdsx releases: https://github.com/zzstoatzz/pdsx/releases
- ATProto specs: https://atproto.com
- plyr.fm track schema: `src/backend/_internal/atproto/records.py:build_track_record`
