# artist identity refactor

## problem

currently, track uploads have an inconsistent identity model:
- users authenticate via ATProto (get DID + handle)
- users manually enter "artist" name on each upload
- this allows same person to use different artist names across uploads
- no central artist profile/identity

## proposed solution

### 1. new artist model

```python
class Artist(Base):
    """artist profile linked to ATProto identity."""

    __tablename__ = "artists"

    # ATProto identity (immutable)
    did: Mapped[str] = mapped_column(String, primary_key=True)
    handle: Mapped[str] = mapped_column(String, nullable=False)

    # artist profile (mutable)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    bio: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)

    # metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # relationship
    tracks: Mapped[list["Track"]] = relationship("Track", back_populates="artist")
```

### 2. updated track model

```python
class Track(Base):
    """track model."""

    __tablename__ = "tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    file_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    file_type: Mapped[str] = mapped_column(String, nullable=False)

    # artist relationship
    artist_did: Mapped[str] = mapped_column(String, ForeignKey("artists.did"), nullable=False, index=True)
    artist: Mapped["Artist"] = relationship("Artist", back_populates="tracks")

    # removed fields:
    # - artist (str) - now from Artist.display_name
    # - artist_handle (str) - now from Artist.handle

    # rest stays the same...
```

### 3. user flow changes

#### first-time upload flow
1. user authenticates via ATProto
2. **new**: check if Artist profile exists for their DID
3. **new**: if not, show artist profile setup:
   - display name (pre-filled with handle, editable)
   - optional: bio, avatar
4. create Artist record
5. proceed to track upload (no artist field in form)

#### subsequent uploads
1. user authenticates
2. Artist profile already exists
3. go directly to track upload
4. artist automatically set from their profile

#### artist profile management
- new `/portal/profile` page to edit:
  - display name
  - bio
  - avatar
- cannot change DID (immutable)

### 4. migration strategy

#### database migration
```python
# migration script (pseudocode)
def migrate():
    # 1. create artists table
    create_table("artists")

    # 2. extract unique artists from tracks
    # group by artist_did, use first artist value as display_name
    unique_artists = db.execute("""
        SELECT DISTINCT
            artist_did,
            artist_handle,
            first_value(artist) OVER (PARTITION BY artist_did ORDER BY created_at) as display_name
        FROM tracks
        WHERE artist_did IS NOT NULL
    """)

    # 3. create artist records
    for row in unique_artists:
        Artist.create(
            did=row.artist_did,
            handle=row.artist_handle,
            display_name=row.display_name or row.artist_handle,
        )

    # 4. handle tracks with null artist_did
    # option a: delete them (if test data)
    # option b: prompt user to manually fix
    # option c: create placeholder artist

    # 5. add foreign key constraint
    add_foreign_key("tracks", "artist_did", "artists", "did")

    # 6. drop columns
    drop_column("tracks", "artist")
    drop_column("tracks", "artist_handle")
```

#### api changes
- `POST /tracks/` - remove artist field from request body
- `POST /tracks/` - auto-populate artist_did from auth session
- `GET /tracks/` - include artist.display_name in response via join
- `GET /tracks/me` - filter by auth_session.did
- new: `GET /artists/{did}` - get artist profile
- new: `PUT /artists/me` - update own artist profile
- new: `POST /artists/` - create artist profile (first-time setup)

### 5. frontend changes

#### upload page (`/portal`)
- remove artist input field
- show current artist profile at top:
  ```
  uploading as: [display_name] (@handle)
  [edit profile link]
  ```

#### new artist profile page (`/portal/profile`)
- form to edit display_name, bio, avatar
- show DID and handle (read-only)

#### track list components
- update to show artist.display_name
- artist names become clickable links to artist profile

### 6. benefits

- **consistency**: one artist identity per ATProto account
- **discoverability**: artist profiles with bio, tracks, etc.
- **correctness**: artist info updated in one place
- **preparation**: foundation for features like:
  - artist pages
  - follow artists
  - artist verification
  - collaborations (multiple artists per track)

### 7. rollout plan

1. **phase 1**: create Artist model, no migration yet
2. **phase 2**: add artist profile setup UI
3. **phase 3**: run migration on dev database, verify
4. **phase 4**: manual fix for production data (2 tracks)
5. **phase 5**: deploy migration + updated track upload
6. **phase 6**: add artist profile management UI

## open questions

1. ✅ should users be able to change display name? **yes**
2. ✅ should one DID have multiple artist personas? **no (not for MVP)**
3. ✅ default display name? **handle, but configurable**
4. how to handle tracks with null artist_did in production?
   - currently: track 8 and 9 both have null artist_did
   - both uploaded by you (zzstoatzz.io)
   - suggestion: manually update them with your DID
5. require artist profile setup immediately after first login, or defer until first upload?
   - option a: require on first login (extra step, but cleaner)
   - option b: require on first upload (more friction at upload time)
   - **recommendation**: defer until first upload (less friction initially)
