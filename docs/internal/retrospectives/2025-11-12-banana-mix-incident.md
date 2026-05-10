# banana mix incident retrospective

**date**: 2025-11-12
**issue**: track 56 ("banana mix") returned 404 from R2 despite having valid database and ATProto records

## what happened

1. stellz uploaded "banana mix" at 00:05:51 UTC → created track 56 with file_id `589c8ce7032583c7`
2. UI feedback was slow, she thought upload failed
3. stellz uploaded same file again at 00:07:22 UTC → created track 57 with same file_id `589c8ce7032583c7`
4. both uploads pointed to same R2 object: `audio/589c8ce7032583c7.mp3`
5. stellz deleted track 57 at 00:08:20 UTC
6. deletion called `storage.delete(track.file_id)` which removed the R2 file
7. track 56 left with dangling R2 reference → 404 errors

## root cause

three distinct bugs enabled this:

1. **no duplicate detection**: same file can create multiple tracks (file_id unique constraint removed in migration `ba46ea4ba64e`)
2. **unsafe R2 deletion**: `storage.delete()` doesn't check refcount before deleting files
3. **orphaned ATProto records**: `delete_track()` doesn't clean up PDS records, leaving `fm.plyr.track` records after track deletion

## timeline

```
00:05:51 - track 56 created (first upload)
00:07:22 - track 57 created (duplicate upload, same file_id)
00:08:20 - track 57 deleted → R2 file removed
         - track 56 now broken (404)
         - ATProto record for track 57 orphaned on PDS
```

## how we fixed it

### immediate fix

stellz sent correct file via google drive. uploaded manually using aws cli:

```bash
# ad-hoc upload script (masks secrets to first 4 chars)
cd ~/Downloads && \
AWS_ACCESS_KEY_ID=ca05... \
AWS_SECRET_ACCESS_KEY=860e... \
aws s3 cp stellz_banana_mix.mp3 \
  s3://audio-prod/audio/589c8ce7032583c7.mp3 \
  --endpoint-url https://8feb... \
  --content-type audio/mpeg
```

stellz manually deleted orphaned ATProto record `3m5hup67fpr2c` from her PDS.

### created backfill script

created `scripts/backfill_missing_r2_file.py` for future incidents:

```python
class BackfillSettings(BaseSettings):
    database_url: str = Field(validation_alias="ADMIN_DATABASE_URL")
    aws_access_key_id: str = Field(validation_alias="ADMIN_AWS_ACCESS_KEY_ID")
    aws_secret_access_key: str = Field(validation_alias="ADMIN_AWS_SECRET_ACCESS_KEY")
    r2_endpoint_url: str = Field(validation_alias="ADMIN_R2_ENDPOINT_URL")
    r2_bucket: str = Field(validation_alias="ADMIN_R2_BUCKET")

# usage:
# uv run scripts/backfill_missing_r2_file.py <audio_file> <track_id>
```

uses `ADMIN_*` prefixed env vars to target production database/storage.

## what we need to prevent this

### 1. add duplicate detection (high priority)

in `src/backend/api/tracks.py`, after `storage.save()`:

```python
# after getting file_id from storage
async with db_session() as db:
    stmt = select(Track).where(
        Track.file_id == file_id,
        Track.artist_did == artist_did
    )
    existing = await db.execute(stmt)
    if existing.scalar_one_or_none():
        # return 409 with existing track instead of creating duplicate
        return Response(status_code=409, content={"existing_track_id": existing.id})
```

this prevents re-uploads from creating duplicate rows.

### 2. make R2 deletions reference-safe (high priority)

in `src/backend/storage/r2.py:delete()`:

```python
async def delete(self, file_id: str) -> bool:
    # check refcount before deleting
    async with db_session() as db:
        stmt = select(func.count()).select_from(Track).where(Track.file_id == file_id)
        result = await db.execute(stmt)
        refcount = result.scalar_one()

        if refcount > 1:
            logfire.info("skipping R2 delete, file still referenced", file_id=file_id, refcount=refcount)
            return False

    # safe to delete - only one reference
    async with self.async_session.client(...) as client:
        await client.delete_object(Bucket=self.audio_bucket_name, Key=key)
```

prevents "delete duplicate and nuke original" scenario.

### 3. clean up ATProto records on delete (high priority)

in `src/backend/api/tracks.py:delete_track()`:

```python
# before deleting DB row
if track.atproto_record_uri:
    try:
        await delete_record_by_uri(auth_session, track.atproto_record_uri)
    except Exception as e:
        if "404" in str(e):
            # record already gone, that's fine
            pass
        else:
            # other errors should bubble
            raise

# then delete DB row
await db.delete(track)
```

keeps PDS in sync with our database.

### 4. improve UI feedback (medium priority)

slow upload feedback caused the duplicate upload. add:
- progress indicator during upload
- disable upload button after click
- show clear success/error states

### 5. optional: restore uniqueness constraint

if we decide duplicates should never exist, re-add partial unique index:

```sql
CREATE UNIQUE INDEX tracks_file_id_artist_did_key
ON tracks(file_id, artist_did);
```

keeps database honest even if code forgets the check.

## lessons learned

- removing unique constraints enables subtle race conditions
- deletion operations need refcount checks for shared resources
- ATProto records must be kept in sync with local state
- slow UI feedback can trigger duplicate submissions
- need better tooling for production debugging (backfill script helps)

## related files

- `src/backend/api/tracks.py` - upload and delete endpoints
- `src/backend/storage/r2.py` - R2 storage operations
- `alembic/versions/ba46ea4ba64e_remove_unique_constraint_from_tracks_.py` - migration that removed unique constraint
- `scripts/backfill_missing_r2_file.py` - manual recovery script
- `scripts/delete_track.py` - track deletion (has same ATProto cleanup issue)

## action items

- [ ] implement duplicate detection in upload endpoint
- [ ] add refcount check to `storage.delete()`
- [ ] clean up ATProto records in `delete_track()`
- [ ] add upload progress indicator to UI
- [ ] consider restoring unique constraint on `(file_id, artist_did)`
