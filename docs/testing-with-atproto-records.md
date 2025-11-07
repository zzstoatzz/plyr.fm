# testing with atproto records

guide for managing test data in the ATProto collections using `pdsls`.

## setup

install the pdsls CLI:

```bash
pip install pdsls
# or with uv
uv tool install pdsls
```

set your credentials (use a test account):

```bash
export ATPROTO_HANDLE=your-test-account.bsky.social
export ATPROTO_PASSWORD=your-app-password
```

## common operations

### list tracks in old namespace

```bash
pdsls ls app.relay-dev.track
```

### list tracks in new namespace

```bash
pdsls ls fm.plyr.track
```

### create test tracks

```bash
# create with minimal fields
pdsls touch app.relay-dev.track \
  title="Test Track" \
  artist="Test Artist" \
  audioUrl="https://example.com/test.m4a" \
  fileType="m4a" \
  createdAt="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

# create with optional fields
pdsls touch fm.plyr.track \
  title="Full Track" \
  artist="Artist Name" \
  audioUrl="https://example.com/track.m4a" \
  fileType="m4a" \
  album="Album Name" \
  duration=180 \
  createdAt="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
```

### get specific record

```bash
pdsls cat at://did:plc:xxx/fm.plyr.track/3m4zfeci3c527
```

### delete records

```bash
# delete single record
pdsls rm at://did:plc:xxx/fm.plyr.track/3m4zfeci3c527

# delete multiple records in a loop
for rkey in 3m4zfeci3c527 3m4zfechxkb27 3m4zfechx6n2i; do
  pdsls rm "at://did:plc:xxx/fm.plyr.track/$rkey"
done
```

### json output for scripting

```bash
# list all tracks as JSON
pdsls ls fm.plyr.track -o json

# get specific fields with jq
pdsls ls fm.plyr.track -o json | jq '.[].value.title'

# count tracks
pdsls ls fm.plyr.track -o json | jq 'length'

# filter tracks by artist
pdsls ls fm.plyr.track -o json | jq '.[] | select(.value.artist == "Test Artist")'
```

## testing migration workflow

### 1. create test data in old collection

```bash
# create several test tracks
for i in {1..3}; do
  pdsls touch app.relay-dev.track \
    title="Test Track $i" \
    artist="Test Artist" \
    audioUrl="https://example.com/test$i.m4a" \
    fileType="m4a" \
    createdAt="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
done
```

### 2. verify records exist

```bash
pdsls ls app.relay-dev.track
```

### 3. run migration via UI

navigate to your profile in the web app and click the migration banner to migrate records from `app.relay-dev.track` to `fm.plyr.track`.

### 4. verify migration

```bash
# check old collection is empty
pdsls ls app.relay-dev.track

# check new collection has records
pdsls ls fm.plyr.track
```

### 5. clean up test data

```bash
# get all rkeys from new collection
pdsls ls fm.plyr.track -o json | jq -r '.[].uri | split("/")[-1]'

# delete test records
# (replace xxx with your DID)
for rkey in $(pdsls ls fm.plyr.track -o json | jq -r '.[].uri | split("/")[-1]'); do
  pdsls rm "at://did:plc:xxx/fm.plyr.track/$rkey"
done
```

## useful helpers

### get your DID

```bash
curl -s "https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=your-handle.bsky.social" | jq -r '.did'
```

### create bulk test data

```bash
#!/bin/bash
# create-test-tracks.sh

DID="did:plc:xxx"  # replace with your DID
COLLECTION="app.relay-dev.track"

TRACKS=(
  "True Faith|New Order|https://example.com/1.m4a"
  "Blue Monday|New Order|https://example.com/2.m4a"
  "Bizarre Love Triangle|New Order|https://example.com/3.m4a"
)

for track in "${TRACKS[@]}"; do
  IFS='|' read -r title artist url <<< "$track"
  pdsls touch "$COLLECTION" \
    title="$title" \
    artist="$artist" \
    audioUrl="$url" \
    fileType="m4a" \
    createdAt="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  echo "created: $title"
done
```

### delete all records in collection

```bash
#!/bin/bash
# clean-collection.sh

DID="did:plc:xxx"  # replace with your DID
COLLECTION="fm.plyr.track"

echo "fetching records from $COLLECTION..."
URIS=$(pdsls ls "$COLLECTION" -o json | jq -r '.[].uri')

if [ -z "$URIS" ]; then
  echo "no records found"
  exit 0
fi

echo "found $(echo "$URIS" | wc -l) records"
echo "deleting..."

while IFS= read -r uri; do
  pdsls rm "$uri"
  echo "deleted: $uri"
done <<< "$URIS"

echo "done"
```

## tips

- **use test accounts**: never use production credentials for testing
- **batch operations**: use bash loops for bulk operations
- **json mode**: combine with `jq` for powerful filtering and transformation
- **backup before delete**: save records to JSON before bulk deletes: `pdsls ls collection -o json > backup.json`
- **unix philosophy**: pdsls follows unix conventions - pipe output, compose with other tools

## troubleshooting

### "authentication failed"

check your credentials:
```bash
echo $ATPROTO_HANDLE
echo $ATPROTO_PASSWORD
```

### "record not found"

verify the URI format and that the record exists:
```bash
pdsls ls collection -o json | jq '.[].uri'
```

### "invalid did"

get your DID:
```bash
curl -s "https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=$ATPROTO_HANDLE" | jq -r '.did'
```

## see also

- [pdsls on PyPI](https://pypi.org/project/pdsls/)
- [ATProto docs](https://atproto.com/docs)
- configuration: `docs/configuration.md`
- migration design: see `src/backend/api/migration.py`
