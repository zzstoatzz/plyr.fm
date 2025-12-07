# pdsx mcp guide for plyr.fm

the [pdsx mcp server](https://github.com/zzstoatzz/pdsx) provides tools for interacting with ATProto records on personal data servers (PDS) through the model context protocol. this guide covers operations useful for inspecting and managing plyr.fm track records.

## overview

the pdsx mcp is integrated into claude code and provides direct access to:
- listing records in collections
- reading individual records by URI
- creating, updating, and deleting records (authenticated operations)
- automatic PDS URL resolution from handles or DIDs

this guide focuses on **read operations** for inspecting records. write operations require authentication and are typically handled by scripts.

## authentication

some operations require authentication:
- **read operations** with `repo` parameter: no auth needed (reads public data)
- **read operations** without `repo`: auth needed (reads your own records)
- **write operations** (create, update, delete): always require auth

the mcp automatically resolves PDS URLs from handles or DIDs, so you typically don't need to specify PDS URLs explicitly.

## listing records

### list all tracks for a user

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

returns a list of records with:
- `uri` - full AT-URI (`at://did/collection/rkey`)
- `cid` - content identifier
- `value` - cleaned record data (title, artist, audioUrl, etc.)

**parameters**:
- `collection` (required): the collection to list (e.g., `fm.plyr.track`)
- `repo` (optional): handle or DID to read from. if not provided, reads your own records (requires auth)
- `limit` (optional): max records to return (default 50)
- `cursor` (optional): pagination cursor from previous response

**examples**:
- list someone's tracks: `mcp__pdsx__list_records({"collection": "fm.plyr.track", "repo": "zzstoatzz.io"})`
- list your own tracks (requires auth): `mcp__pdsx__list_records({"collection": "fm.plyr.track"})`

### filtering results

the `list_records` and `get_record` tools support a `_filter` parameter with jmespath for filtering and transforming results:

```json
mcp__pdsx__list_records({
  "collection": "fm.plyr.track",
  "repo": "zzstoatzz.io",
  "_filter": "[*].uri"
})
```

this extracts just the URIs. see https://jmespath.org for full syntax.

## reading records

### get a specific record

track URIs have the format: `at://did/collection/rkey`

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

returns a record with:
- `uri` - full AT-URI
- `cid` - content identifier
- `value` - cleaned record data with fields:
  - `title` - track title
  - `artist` - artist name
  - `audioUrl` - R2 storage URL
  - `fileType` - audio format (mp3, m4a, etc.)
  - `album` - album name (optional)
  - `features` - collaborating artists (optional)
  - `imageUrl` - album art URL (optional)
  - `createdAt` - ISO timestamp

**parameters**:
- `uri` (required): full AT-URI or shorthand (collection/rkey)
- `repo` (optional): when using shorthand uri, the repo to read from

**examples**:
- get by full URI: `mcp__pdsx__get_record({"uri": "at://did:plc:.../fm.plyr.track/abc123"})`
- get by shorthand (requires auth): `mcp__pdsx__get_record({"uri": "fm.plyr.track/abc123"})`
- get someone's profile: `mcp__pdsx__get_record({"uri": "app.bsky.actor.profile/self", "repo": "zzstoatzz.io"})`

## write operations

### create record

```json
mcp__pdsx__create_record({
  "collection": "fm.plyr.track",
  "record": {
    "title": "my track",
    "artist": "artist name",
    "audioUrl": "https://...",
    "fileType": "mp3"
  }
})
```

**requires authentication**. `$type` and `createdAt` are auto-added if missing.

### update record

```json
mcp__pdsx__update_record({
  "uri": "fm.plyr.track/abc123",
  "updates": {
    "album": "new album name"
  }
})
```

**requires authentication**. fetches the current record, merges your updates, and puts it back.

### delete record

```json
mcp__pdsx__delete_record({
  "uri": "fm.plyr.track/abc123"
})
```

**requires authentication**. accepts full AT-URI or shorthand.

## debugging orphaned/stale records

### scenario 1: tracks in database but no ATProto records

1. list records on PDS:
   ```json
   mcp__pdsx__list_records({
     "collection": "fm.plyr.track",
     "repo": "zzstoatzz.io"
   })
   ```

2. query database for tracks with that artist_did (use neon MCP):
   ```json
   mcp__neon__run_sql({
     "projectId": "muddy-flower-98795112",
     "sql": "SELECT id, title, atproto_record_uri FROM tracks WHERE artist_did = 'did:plc:xbtmt2zjwlrfegqvch7fboei'"
   })
   ```

3. compare - any tracks in DB without `atproto_record_uri` are orphaned

### scenario 2: stale URIs pointing to old namespace

check for old namespace records (should be none in `fm.plyr.track`):

```json
mcp__pdsx__list_records({
  "collection": "app.relay.track",
  "repo": "zzstoatzz.io"
})
```

if you find any, those are stale and should be migrated.

### scenario 3: verify record contents match database

get a specific record and compare with database:

```json
mcp__pdsx__get_record({
  "uri": "at://did:plc:xbtmt2zjwlrfegqvch7fboei/fm.plyr.track/3m5a4wg7i352p"
})
```

compare `imageUrl`, `features`, `album`, etc. with database values. mismatches indicate failed updates.

## atproto namespace

plyr.fm uses environment-specific namespaces configured via `ATPROTO_APP_NAMESPACE`:
- **dev**: `fm.plyr.dev` → track collection: `fm.plyr.dev.track`
- **staging**: `fm.plyr.stg` → track collection: `fm.plyr.stg.track`
- **prod**: `fm.plyr` → track collection: `fm.plyr.track`

**critical**: never use bluesky lexicons (`app.bsky.*`) for plyr.fm records. always use `fm.plyr.*` namespace.

when querying dev environment, use `fm.plyr.dev.track`, not `fm.plyr.track`.

## workflow examples

### verify backfill success

after running `scripts/backfill_atproto_records.py`:

1. check how many records were created:
   ```json
   mcp__pdsx__list_records({
     "collection": "fm.plyr.track",
     "repo": "zzstoatzz.io"
   })
   ```

2. verify specific tracks have correct data by filtering the results

3. confirm imageUrl present for tracks that should have it by inspecting individual records

### compare database vs atproto records

when debugging sync issues:

1. get record count from PDS (count the results from `list_records`)

2. get record count from database (use neon MCP):
   ```json
   mcp__neon__run_sql({
     "projectId": "muddy-flower-98795112",
     "sql": "SELECT COUNT(*) FROM tracks WHERE artist_did = 'did:plc:xbtmt2zjwlrfegqvch7fboei' AND atproto_record_uri IS NOT NULL"
   })
   ```

3. if counts don't match, list all records to find missing ones

## troubleshooting

### authentication errors

if you get authentication errors for read operations:
- ensure `repo` parameter is provided for public reads
- for reading your own records without `repo`, ensure MCP is configured with auth headers

### "could not find repo" errors

this means:
- DID/handle doesn't exist on the queried PDS
- using wrong PDS (bsky.social vs custom)

solution: verify handle/DID is correct. the mcp automatically resolves PDS URLs, so this is usually a handle/DID issue.

### empty results when you expect records

check:
1. are you querying the right collection? (`fm.plyr.track` not `app.relay.track`)
2. does the user actually have records? (check database with neon MCP)
3. are you using the correct namespace for the environment? (dev vs staging vs prod)

## cli usage (for scripts)

scripts may use the pdsx CLI directly. the CLI provides the same functionality as the MCP but is better suited for automation:

```bash
# list records
uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track

# get a record
uvx pdsx --pds https://pds.zzstoatzz.io cat at://did:plc:xbtmt2zjwlrfegqvch7fboei/fm.plyr.track/3m5a4wg7i352p
```

see scripts like `backfill_atproto_records.py` and `migrate_atproto_namespace.py` for examples of CLI usage in automation.

## related tools

- **neon MCP**: for querying the database (see docs/tools/neon.md)
- **pdsx CLI**: for script automation (see scripts/)
- **PLC directory**: for resolving PDS URLs from DIDs (see docs/backend/atproto-identity.md)

## references

- pdsx mcp server: https://github.com/zzstoatzz/pdsx
- pdsx documentation: https://pdsx.zzstoatzz.io
- pdsx releases: https://github.com/zzstoatzz/pdsx/releases
- ATProto specs: https://atproto.com
- plyr.fm track schema: `src/backend/_internal/atproto/records.py:build_track_record`
