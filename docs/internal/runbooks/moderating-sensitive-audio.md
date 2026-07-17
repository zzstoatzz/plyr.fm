---
title: "moderating sensitive audio"
---

use this runbook when an operator confirms that a track contains sexual or
pornographic audio and it must be hidden from default and anonymous playback.
The durable action is a signed ATProto label. `visibility = 'unlisted'` is not a
moderation state and must not be the final fix.

## 1. prove access first

complete the [agent access preflight](/tools/agent-access/) before classifying or
changing anything. The required write capability is
`MODERATION_AUTH_TOKEN`; `MODERATION_BSKY_PASSWORD` is not a substitute.

check that the token exists without displaying it:

```bash
test -n "${MODERATION_AUTH_TOKEN:-}" || {
  echo "MODERATION_AUTH_TOKEN is required" >&2
  exit 1
}
```

if it is stored in a project `.env`, source that file without echoing values.
Do not use `env`, `printenv`, shell tracing, or a command that includes the
expanded token in its output.

## 2. identify the exact track subject

start from the production track ID, not a title search:

```bash
TRACK_ID=1177
TRACK_JSON="$(curl -fsS "https://api.plyr.fm/tracks/$TRACK_ID")"
URI="$(jq -r '.atproto_record_uri' <<<"$TRACK_JSON")"
CID="$(jq -r '.atproto_record_cid' <<<"$TRACK_JSON")"
FILE_ID="$(jq -r '.file_id' <<<"$TRACK_JSON")"

jq '{id, title, artist_handle, atproto_record_uri, atproto_record_cid, self_labels, labels, visibility}' \
  <<<"$TRACK_JSON"
```

stop if the URI or CID is null. Confirm the audio itself; titles, descriptions,
tags, creator identity, and neighboring uploads are context, not evidence.

## 3. choose the label

use the global ATProto values rather than inventing a plyr.fm taxonomy:

| value | operator rubric | upstream default |
|---|---|---|
| `sexual` | sexual discussion, sounds, or explicit themes that require an adult-content warning | warn |
| `porn` | audio whose primary purpose is pornographic content | hide |

ATProto marks both values as adult media labels. plyr.fm deliberately applies
the same default-hide and opt-in policy to both. When uncertain between these
two values, use `sexual`; do not escalate to `porn` merely because the content
is explicit.

## 4. emit the signed label

```bash
LABEL=sexual

curl -fsS -X POST https://moderation.plyr.fm/emit-label \
  -H "X-Moderation-Key: $MODERATION_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$(jq -cn \
    --arg uri "$URI" \
    --arg cid "$CID" \
    --arg val "$LABEL" \
    '{uri: $uri, cid: $cid, val: $val}')" \
  | jq '{seq, label: {src: .label.src, uri: .label.uri, cid: .label.cid, val: .label.val, cts: .label.cts}}'
```

the response must contain a sequence number, the expected URI/CID/value, and
the plyr.fm labeler DID. Never log the signature or authorization header in an
incident note.

## 5. invalidate cached empty-label results

the backend caches complete active-label sets, including an empty set, for five
minutes. Discovery, album, and radio responses also have caches. In an urgent
moderation action, invalidate them instead of waiting for TTL expiry:

```bash
fly ssh console -a relay-api -g app -C \
  "uv run --no-sync python -c \"import os, redis; r=redis.Redis.from_url(os.environ['REDIS_URL']); keys=['plyr:copyright-label:values:$URI','plyr:copyright-label:$URI','plyr:tracks:discovery:v2']; keys += list(r.scan_iter(match='plyr:radio:rotation:v2:*')); keys += list(r.scan_iter(match='plyr:album:v2:*')); print({'deleted': r.delete(*keys), 'targeted': len(keys)})\""
```

the historical `plyr:copyright-label:` prefix now stores generic label values;
the name is legacy, not evidence that only copyright is cached.

## 6. verify the assertion and policy

verify the public labeler first:

```bash
curl -fsS -G \
  https://moderation.plyr.fm/xrpc/com.atproto.label.queryLabels \
  --data-urlencode "uriPatterns=$URI" \
  | jq --arg val "$LABEL" '[.labels[] | select(.val == $val and (.neg != true))]'
```

then verify product enforcement:

```bash
# direct metadata remains public but carries the label and protected audio URL
curl -fsS "https://api.plyr.fm/tracks/$TRACK_ID" \
  | jq '{id, visibility, unlisted, labels, r2_url}'

# signed-out playback must be denied and identify the policy label
curl -sS -D - -o /dev/null "https://api.plyr.fm/audio/$FILE_ID" \
  | rg -i '^(HTTP/|x-content-labels:)'

# the track must not be in anonymous discovery or fresh radio
curl -fsS 'https://api.plyr.fm/tracks/?limit=100' \
  | jq --argjson id "$TRACK_ID" '[.tracks[] | select(.id == $id)]'
curl -fsS 'https://api.plyr.fm/radio/state?station=fresh&limit=75' \
  | jq --argjson id "$TRACK_ID" '[.rotation[] | select(.id == $id)]'
```

expected results:

- track metadata: `visibility: "public"`, `unlisted: false`, and the label in
  `labels`
- audio: `401` plus `X-Content-Labels` for a signed-out request
- discovery and radio: empty arrays

also search for the title/creator when the incident began in search, an album,
or another public collection.

## negating an incorrect label

revocation is a new signed event; never delete label history:

```bash
curl -fsS -X POST https://moderation.plyr.fm/emit-label \
  -H "X-Moderation-Key: $MODERATION_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$(jq -cn \
    --arg uri "$URI" \
    --arg cid "$CID" \
    --arg val "$LABEL" \
    '{uri: $uri, cid: $cid, val: $val, neg: true}')"
```

repeat cache invalidation and verification after the negation.

## emergency visibility changes

if immediate harm requires a temporary `unlisted` change before label access is
available, record the original visibility and restore it as soon as the signed
label is active. Verify final production visibility counts. An emergency
visibility change that remains after label enforcement is a failed cleanup.

## declaration changes

the labeler account currently declares `copyright-violation`, `sexual`, and
`porn`. Emitting one of those values does not require an ATProto account update.
Introducing a new value is a separate change: review taxonomy first, then update
`app.bsky.labeler.service/self` using `MODERATION_BSKY_PASSWORD` with an atomic
`swapRecord`. Do not add undeclared values during incident response.
