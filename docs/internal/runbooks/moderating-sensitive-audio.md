---
title: "moderating sensitive audio"
---

use this runbook when an operator confirms that a track contains sexual or
pornographic audio and must be hidden from default surfaces. The durable action
is a signed ATProto label. `visibility = 'unlisted'` is not a moderation state
and must not be the final fix.

**adult labels do not block playback.** They keep a track out of discovery,
search, collections, and radio unless a signed-in listener opted in. A direct
link still plays, for anyone. Requiring an account to press play looked like an
age check but was not — any account satisfied it — while breaking a creator's
ability to share their own work. See
[label policy](/moderation/label-policy/). If you need a track to stop being
reachable at all, that is a takedown, not a label.

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

## 5. cache invalidation happens on its own

**no manual Redis purge.** The backend subscribes to the labeler's
`subscribeLabels` stream and refreshes both the label cache and the
`tracks.operator_labels` projection as each label commits — measured at under a
second, versus the five-minute TTL it used to wait out. See
`backend/_internal/label_stream.py`.

if enforcement has not taken effect after a minute, check that the subscriber is
connected before reaching for anything manual:

```bash
# expect a recent "label stream connected" for the environment in question
```

query Logfire for `message ILIKE '%label stream%'`. A disconnected subscriber
falls back to the five-minute `sync_operator_labels` pass, so the effect still
lands; it is late, not lost.

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
# direct metadata remains public and carries the label
curl -fsS "https://api.plyr.fm/tracks/$TRACK_ID" \
  | jq '{id, visibility, unlisted, labels}'

# the permalink must still play — a label is not an access control
curl -sS -o /dev/null -w '%{http_code}\n' "https://api.plyr.fm/audio/$FILE_ID"

# the track must not be in anonymous discovery or fresh radio
curl -fsS 'https://api.plyr.fm/tracks/?limit=100' \
  | jq --argjson id "$TRACK_ID" '[.tracks[] | select(.id == $id)]'
curl -fsS 'https://api.plyr.fm/radio/state?station=fresh&limit=75' \
  | jq --argjson id "$TRACK_ID" '[.rotation[] | select(.id == $id)]'
```

expected results:

- track metadata: `visibility: "public"`, `unlisted: false`, and the label in
  `labels`
- audio: `307` — the permalink still resolves. A `401` here would mean the
  byte-level gate was reintroduced, which is a regression, not enforcement
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

verify after the negation the same way. Negation clears through the same
subscriber, so again there is nothing to purge by hand.

**negating is not the only correction.** A negation says the assertion was
wrong. If the label is right but the track should stay up anyway — a cover, a
licensed remix — record an `override_allow` decision instead, which keeps the
assertion honest and still surfaces the track. See
[label policy](/moderation/label-policy/).

## record the decision

every action belongs in the moderation event log, which is the review queue,
the audit trail, and the input to the public transparency post. Emitting a
label alone leaves no record of *who* decided or *why*:

```bash
curl -fsS -X POST https://moderation.plyr.fm/admin/events \
  -H "X-Moderation-Key: $MODERATION_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$(jq -cn --arg uri "$URI" --argjson tid "$TRACK_ID" \
    '{subject_uri: $uri, subject_track_id: $tid, action: "label_applied",
      actor: "your.handle", reason: "adult_audio", notes: "..."}')"
```

`actor` is required. In practice use the dashboard at
`https://moderation.plyr.fm/admin`, which records this for you and plays the
track so a call can be made by listening.

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
