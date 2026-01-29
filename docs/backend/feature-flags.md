# feature flags

per-user feature flags for controlled rollout of experimental features.

## overview

feature flags allow specific features to be enabled for individual users before general availability. this supports:
- **testing** - enable for internal testers first
- **gradual rollout** - expand to users who request access
- **hiding experiments** - features are completely invisible to users without the flag

flags are stored in a dedicated database table and exposed via the `/auth/me` endpoint.

## database schema

```sql
CREATE TABLE feature_flags (
    id SERIAL PRIMARY KEY,
    user_did VARCHAR NOT NULL REFERENCES artists(did) ON DELETE CASCADE,
    flag VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_did, flag)
);

CREATE INDEX ix_feature_flags_user_did ON feature_flags(user_did);
```

each row represents one flag enabled for one user. the unique constraint prevents duplicate entries.

## known flags

flags are documented in `backend/_internal/feature_flags.py`:

```python
KNOWN_FLAGS = frozenset({
    "lossless-uploads",  # enable AIFF/FLAC upload support
    "pds-audio-uploads",  # enable PDS audio blob uploads
})
```

add new flags to `KNOWN_FLAGS` for documentation purposes.

## checking flags in code

### backend

```python
from backend._internal import has_flag, get_user_flags

# check a specific flag
if await has_flag(db, user_did, "lossless-uploads"):
    # feature is enabled for this user
    pass

# get all flags for a user
flags = await get_user_flags(db, user_did)  # ["lossless-uploads", "pds-audio-uploads", ...]
```

### frontend

flags are returned in the `/auth/me` response:

```typescript
// $lib/state/auth.svelte.ts
const auth = getAuth();

if (auth.user?.enabled_flags.includes("lossless-uploads")) {
    // show lossless upload UI
}
```

## api

### GET /auth/me

returns the current user's enabled flags:

```json
{
    "did": "did:plc:abc123",
    "handle": "alice.bsky.social",
    "linked_accounts": [...],
    "enabled_flags": ["lossless-uploads"]
}
```

## admin script

manage flags via the admin script (requires `DATABASE_URL`):

```bash
cd backend

# enable a flag for a user
DATABASE_URL="..." uv run python ../scripts/feature_flag.py enable --user zzstoatzz.io --flag lossless-uploads

# disable a flag
DATABASE_URL="..." uv run python ../scripts/feature_flag.py disable --user zzstoatzz.io --flag lossless-uploads

# list flags for a user
DATABASE_URL="..." uv run python ../scripts/feature_flag.py list --user zzstoatzz.io

# list all users with flags
DATABASE_URL="..." uv run python ../scripts/feature_flag.py list-all
```

users can be specified by handle or DID.

## adding a new flag

1. **add to KNOWN_FLAGS** in `backend/_internal/feature_flags.py`:
   ```python
   KNOWN_FLAGS = frozenset({
       "lossless-uploads",
       "new-feature",  # description of what this enables
   })
   ```

2. **check the flag** in backend code where the feature is gated:
   ```python
   if not await has_flag(db, user_did, "new-feature"):
       raise HTTPException(400, "feature not available")
   ```

3. **check the flag** in frontend if UI needs to be hidden:
   ```typescript
   {#if auth.user?.enabled_flags.includes("new-feature")}
       <NewFeatureButton />
   {/if}
   ```

4. **enable for testers** via the admin script

## rollout strategy

typical progression for a new feature:

1. **phase 0**: flag exists in `KNOWN_FLAGS`, no users have it enabled
2. **phase 1**: enable for internal testers (ourselves)
3. **phase 2**: enable for users who request access
4. **phase 3**: general availability (remove flag checks, or add to user preferences)

## design decisions

### why a separate table?

considered storing flags as an array column on the Artist model, but:
- "Artist" conflates with "user" - not all users are artists
- separate table is more normalized and future-proof
- easier to query "all users with flag X"
- cleaner foreign key relationship

### why not user preferences?

user preferences are opt-in/opt-out for visible features. feature flags are for features that should be **completely hidden** until enabled by an admin. users can't enable a preference they can't see.

### naming convention

flags use kebab-case: `lossless-uploads`, `beta-ui`, `early-access`
