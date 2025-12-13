# tap

bluesky's ATProto sync utility for backfilling and streaming custom lexicons.

## install

```bash
go install github.com/bluesky-social/indigo/cmd/tap@latest
```

binary lands at `~/go/bin/tap`

## run locally

```bash
TAP_SIGNAL_COLLECTION=fm.plyr.track \
TAP_COLLECTION_FILTERS=fm.plyr.* \
TAP_LOG_LEVEL=info \
~/go/bin/tap run
```

this will:
1. enumerate all repos with `fm.plyr.track` via `com.atproto.sync.listReposByCollection`
2. backfill those repos, extracting any `fm.plyr.*` records
3. stream the firehose for new records
4. serve events via websocket at `ws://localhost:2480/channel`

## what we found

initial network scan (dec 2025):
- 35 repos with `fm.plyr.track` records
- 497 total records indexed

breakdown:
```
fm.plyr.track           273
fm.plyr.like             90
fm.plyr.list             41
fm.plyr.dev.track        18
fm.plyr.comment          15
fm.plyr.actor.profile    13
(plus staging/dev variants)
```

## consuming events

events come through `/channel` websocket as JSON:

```json
{
  "id": 439,
  "type": "record",
  "record": {
    "live": false,
    "did": "did:plc:...",
    "collection": "fm.plyr.track",
    "rkey": "3m7m3wyasmi2l",
    "action": "create",
    "record": {
      "title": "...",
      "artist": "...",
      "audioUrl": "https://..."
    }
  }
}
```

ack events to consume them: `{"ack": <id>}`

see `sandbox/tap/read_events.py` for example consumer.

## api endpoints

- `GET /health` - status check
- `POST /repos/add` - track a DID
- `POST /repos/remove` - stop tracking
- `GET /stats/repo-count` - tracked repos
- `GET /stats/record-count` - indexed records
- `WS /channel` - event stream

## resources

- [tap README](https://github.com/bluesky-social/indigo/blob/main/cmd/tap/README.md)
- [bailey's guide](https://marvins-guide.leaflet.pub/3m7ttuppfzc23)
- [@atproto/tap](https://www.npmjs.com/package/@atproto/tap) - typescript client
