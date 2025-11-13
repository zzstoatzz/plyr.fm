# neon mcp guide for plyr.fm

the [neon mcp server](https://github.com/neondatabase/mcp-server-neon) provides tools for interacting with neon postgres databases through the model context protocol. this guide covers read-only operations useful for inspecting and debugging plyr.fm's database.

## overview

the neon mcp is integrated into claude code and provides direct access to:
- project and branch management
- database schema inspection
- SQL query execution
- connection string generation

this guide focuses on **read-only operations** - querying and inspecting data without modifications.

## discovering your projects

### list all projects

```json
mcp__neon__list_projects({})
```

returns all neon projects in your account with details like:
- project name and ID
- region (aws-us-east-1, aws-us-east-2, etc.)
- postgres version
- compute usage stats
- storage size

**plyr.fm projects:**
- `plyr` (cold-butterfly-11920742) - production (us-east-1)
- `plyr-dev` (muddy-flower-98795112) - development (us-east-2)
- `plyr-staging` (frosty-math-37367092) - staging (us-west-2)

### get project details

```json
mcp__neon__describe_project({
  "projectId": "muddy-flower-98795112"
})
```

shows branches, compute endpoints, and configuration for a specific project.

## exploring database structure

### list all tables

```json
mcp__neon__get_database_tables({
  "projectId": "muddy-flower-98795112"
})
```

**plyr.fm tables:**
- `tracks` - uploaded music files with metadata
- `artists` - user profiles (DIDs, handles, display names)
- `track_likes` - like interactions between users and tracks
- `user_sessions` - oauth session management
- `oauth_states` - oauth flow state tracking
- `exchange_tokens` - token exchange for auth
- `user_preferences` - user settings
- `queue_state` - processing queue status
- `alembic_version` - database migration tracking

### inspect table schema

```json
mcp__neon__describe_table_schema({
  "projectId": "muddy-flower-98795112",
  "tableName": "tracks"
})
```

returns detailed schema information:
- column names, types, nullable, defaults
- indexes (btree, unique, etc.)
- constraints (primary keys, foreign keys)
- table sizes

**key tracks columns:**
- `id` (integer, primary key)
- `title` (varchar, not null)
- `file_id` (varchar, not null) - R2 storage key
- `file_type` (varchar, not null) - audio format
- `artist_did` (varchar, foreign key → artists)
- `atproto_record_uri` (varchar, nullable) - ATProto record reference
- `atproto_record_cid` (varchar, nullable) - content identifier
- `play_count` (integer, default 0)
- `features` (jsonb, default []) - collaborating artists
- `image_id` (varchar, nullable) - album art reference
- `extra` (jsonb, default {}) - additional metadata (album, etc.)

**key artists columns:**
- `did` (varchar, primary key) - ATProto decentralized identifier
- `handle` (varchar, not null) - user handle
- `display_name` (varchar, not null)
- `pds_url` (varchar, nullable) - custom PDS endpoint

### visualize database structure

```json
mcp__neon__describe_branch({
  "projectId": "muddy-flower-98795112",
  "branchId": "br-crimson-recipe-aesyo0p9"
})
```

returns a tree view showing all databases, schemas, tables, indexes, functions, and sequences.

## running queries

### basic query execution

```json
mcp__neon__run_sql({
  "projectId": "muddy-flower-98795112",
  "sql": "SELECT COUNT(*) FROM tracks"
})
```

**important notes:**
- always provide `projectId`
- queries run on the default branch unless `branchId` is specified
- uses default database `neondb` unless `databaseName` is specified
- results returned as JSON array of objects

### useful plyr.fm queries

#### overview stats

```sql
-- total tracks and artists
SELECT
  COUNT(*) as total_tracks,
  COUNT(DISTINCT artist_did) as total_artists
FROM tracks;

-- atproto integration status
SELECT
  COUNT(*) FILTER (WHERE atproto_record_uri IS NOT NULL) as synced_tracks,
  COUNT(*) FILTER (WHERE atproto_record_uri IS NULL) as unsynced_tracks,
  COUNT(*) FILTER (WHERE image_id IS NOT NULL) as tracks_with_images,
  COUNT(*) FILTER (WHERE image_id IS NULL) as tracks_without_images
FROM tracks;

-- engagement metrics
SELECT
  COUNT(*) as total_likes,
  COUNT(DISTINCT user_did) as unique_likers,
  COUNT(DISTINCT track_id) as liked_tracks
FROM track_likes;

-- storage stats by file type
SELECT
  file_type,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE image_id IS NOT NULL) as with_artwork
FROM tracks
GROUP BY file_type
ORDER BY count DESC;
```

#### artist analytics

```sql
-- artist leaderboard by uploads
SELECT
  a.handle,
  a.display_name,
  COUNT(t.id) as track_count,
  SUM(t.play_count) as total_plays,
  a.pds_url
FROM artists a
LEFT JOIN tracks t ON a.did = t.artist_did
GROUP BY a.did, a.handle, a.display_name, a.pds_url
ORDER BY track_count DESC, total_plays DESC;

-- tracks per artist
SELECT
  artist_did,
  COUNT(*) as track_count
FROM tracks
GROUP BY artist_did
ORDER BY track_count DESC;
```

#### track discovery

```sql
-- recent uploads
SELECT
  t.id,
  t.title,
  a.handle,
  a.display_name,
  t.play_count,
  t.created_at,
  t.atproto_record_uri IS NOT NULL as has_atproto_record,
  t.image_id IS NOT NULL as has_image
FROM tracks t
JOIN artists a ON t.artist_did = a.did
ORDER BY t.created_at DESC
LIMIT 10;

-- most popular tracks
SELECT
  t.id,
  t.title,
  a.handle,
  t.play_count,
  COUNT(tl.id) as like_count
FROM tracks t
JOIN artists a ON t.artist_did = a.did
LEFT JOIN track_likes tl ON t.id = tl.track_id
GROUP BY t.id, t.title, a.handle, t.play_count
ORDER BY t.play_count DESC, like_count DESC
LIMIT 10;

-- tracks with album metadata
SELECT
  t.title,
  t.extra->>'album' as album,
  a.handle
FROM tracks t
JOIN artists a ON t.artist_did = a.did
WHERE t.extra->>'album' IS NOT NULL;
```

#### time-series analysis

```sql
-- uploads per day
SELECT
  DATE_TRUNC('day', created_at) as day,
  COUNT(*) as uploads
FROM tracks
GROUP BY day
ORDER BY day DESC;

-- engagement trends
SELECT
  DATE_TRUNC('day', tl.created_at) as day,
  COUNT(*) as likes_given
FROM track_likes tl
GROUP BY day
ORDER BY day DESC;
```

#### atproto integration debugging

```sql
-- tracks missing atproto records
SELECT
  t.id,
  t.title,
  t.artist_did,
  a.handle,
  a.pds_url,
  t.created_at
FROM tracks t
JOIN artists a ON t.artist_did = a.did
WHERE t.atproto_record_uri IS NULL
ORDER BY t.created_at DESC
LIMIT 20;

-- verify atproto record URIs format
SELECT
  id,
  title,
  atproto_record_uri,
  atproto_record_cid,
  created_at
FROM tracks
WHERE atproto_record_uri IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;

-- check for uri/cid mismatches (uri present but cid missing or vice versa)
SELECT
  id,
  title,
  atproto_record_uri IS NOT NULL as has_uri,
  atproto_record_cid IS NOT NULL as has_cid
FROM tracks
WHERE (atproto_record_uri IS NULL) != (atproto_record_cid IS NULL)
LIMIT 20;
```

#### jsonb field queries

```sql
-- query features array (collaborations)
SELECT
  t.title,
  a.handle,
  jsonb_array_length(t.features) as feature_count,
  t.features
FROM tracks t
JOIN artists a ON t.artist_did = a.did
WHERE jsonb_array_length(t.features) > 0;

-- query extra metadata
SELECT
  title,
  extra->>'album' as album,
  extra->>'genre' as genre,
  extra
FROM tracks
WHERE extra != '{}'::jsonb;
```

## connection management

### get connection string

```json
mcp__neon__get_connection_string({
  "projectId": "muddy-flower-98795112"
})
```

returns a postgres connection string for use with `psql`, database clients, or application configs.

**optional parameters:**
- `branchId` - specific branch (defaults to main)
- `databaseName` - specific database (defaults to neondb)
- `roleName` - specific role (defaults to neondb_owner)

**example output:**
```
postgresql://neondb_owner:npg_6CNUVfgtz8bY@ep-flat-haze-aefjvcba-pooler.c-2.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require
```

## database environment mapping

plyr.fm uses different neon projects for each environment:

| environment | project name | project ID | region | endpoint |
|------------|--------------|-----------|---------|----------|
| dev | plyr-dev | muddy-flower-98795112 | us-east-2 | ep-flat-haze-aefjvcba |
| staging | plyr-staging | frosty-math-37367092 | us-west-2 | (varies) |
| prod | plyr | cold-butterfly-11920742 | us-east-1 | ep-young-poetry-a4ueyq14 |

**in .env:**
- default `DATABASE_URL` points to dev (plyr-dev)
- prod connection string is commented out
- admin scripts use `ADMIN_DATABASE_URL` for prod operations

## common workflows

### debugging orphaned records

```sql
-- 1. check for tracks without atproto records
SELECT COUNT(*) FROM tracks WHERE atproto_record_uri IS NULL;

-- 2. identify which artists have orphaned tracks
SELECT
  a.handle,
  COUNT(*) as orphaned_tracks
FROM tracks t
JOIN artists a ON t.artist_did = a.did
WHERE t.atproto_record_uri IS NULL
GROUP BY a.handle;

-- 3. compare with pdsx output
-- use pdsx to list records on PDS:
-- uvx pdsx --pds https://pds.zzstoatzz.io -r zzstoatzz.io ls fm.plyr.track
```

### verifying backfill success

after running `scripts/backfill_atproto_records.py`:

```sql
-- 1. count records with ATProto URIs
SELECT
  COUNT(*) FILTER (WHERE atproto_record_uri IS NOT NULL) as synced,
  COUNT(*) FILTER (WHERE atproto_record_uri IS NULL) as unsynced
FROM tracks;

-- 2. check specific tracks mentioned in backfill
SELECT
  title,
  atproto_record_uri,
  atproto_record_cid
FROM tracks
WHERE title IN ('webhook', 'maxwell', 'ccr')
ORDER BY created_at DESC;

-- 3. verify image_id populated for tracks with artwork
SELECT
  title,
  image_id IS NOT NULL as has_image,
  atproto_record_uri
FROM tracks
WHERE title = 'ccr';
```

### investigating performance issues

```sql
-- find most active artists (could cause rate limiting)
SELECT
  a.handle,
  COUNT(t.id) as track_count,
  MAX(t.created_at) as last_upload,
  a.pds_url
FROM artists a
JOIN tracks t ON a.did = t.artist_did
GROUP BY a.handle, a.pds_url
ORDER BY track_count DESC;

-- check upload patterns for rate limit issues
SELECT
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as uploads
FROM tracks
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

### schema evolution tracking

```sql
-- check current migration version
SELECT version_num FROM alembic_version;

-- inspect recent schema changes via table sizes
SELECT
  table_name,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name)::regclass)) as total_size
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY pg_total_relation_size(quote_ident(table_name)::regclass) DESC;
```

## tips and best practices

### jsonb field access

use `->` for json objects and `->>` for text extraction:

```sql
-- returns json object
SELECT extra->'metadata' FROM tracks;

-- returns text value
SELECT extra->>'album' FROM tracks;

-- filter by nested json
SELECT * FROM tracks WHERE (extra->>'album')::text = 'covid ableton sessions';
```

### counting with filters

postgres supports conditional aggregates:

```sql
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE play_count > 0) as played,
  COUNT(*) FILTER (WHERE play_count = 0) as unplayed
FROM tracks;
```

### working with timestamps

```sql
-- last 24 hours
WHERE created_at > NOW() - INTERVAL '24 hours'

-- specific date range
WHERE created_at BETWEEN '2025-11-01' AND '2025-11-12'

-- group by day/week/month
DATE_TRUNC('day', created_at)
DATE_TRUNC('week', created_at)
DATE_TRUNC('month', created_at)
```

### project id shortcuts

store frequently used project IDs in your notes:

```
dev: muddy-flower-98795112
staging: frosty-math-37367092
prod: cold-butterfly-11920742
```

## limitations

1. **read-only focus**: this guide covers read operations only. for migrations, use alembic or neon's schema migration tools.

2. **no write operations**: the neon mcp supports writes, but they're not covered here to prevent accidental data modifications during debugging.

3. **connection pooling**: queries go through connection poolers (`-pooler` in endpoint). for admin operations or schema changes, use direct endpoints.

4. **query timeouts**: complex queries may timeout. break them into smaller operations or add indexes if slow.

5. **default database**: most operations assume `neondb` database. specify `databaseName` if using different database.

## related tools

- **pdsx**: for inspecting ATProto records on PDS (see docs/tools/pdsx.md)
- **psql**: for interactive postgres sessions using connection strings
- **alembic**: for database migrations (see alembic/versions/)
- **neon console**: web UI at https://console.neon.tech

## references

- neon mcp server: https://github.com/neondatabase/mcp-server-neon
- plyr.fm database models: src/backend/models/
- ATProto integration: src/backend/_internal/atproto/records.py
- migration scripts: scripts/backfill_atproto_records.py
