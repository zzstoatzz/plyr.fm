---
description: Review copyright flags and present recommendations for resolution
argument-hint: [optional flag notification text or track URL/ID]
---

Review copyright flags and present recommendations for the user to confirm.

If the user provided context: $ARGUMENTS

## 1. Gather flags

**If the user provided a specific track ID/URL or flag notification**, extract the track ID and query just that scan.

**Otherwise**, fetch all pending flags from the moderation service:
```bash
source .env && curl -s "https://moderation.plyr.fm/admin/flags?filter=pending" \
  -H "X-Moderation-Key: ${MODERATION_AUTH_TOKEN}"
```

Also check the prod database (`cold-butterfly-11920742`) for recent scans that may not have labels yet:
```sql
SELECT cs.id, cs.track_id, cs.is_flagged, cs.highest_score, cs.matches, cs.scanned_at,
       t.title, a.handle, a.display_name
FROM copyright_scans cs
JOIN tracks t ON cs.track_id = t.id
JOIN artists a ON t.artist_id = a.id
WHERE cs.is_flagged = true
ORDER BY cs.scanned_at DESC
```

## 2. Analyze each flag

For each flagged scan, classify it using these known patterns:

### Self-match (very common)
The primary match artist is the same person who uploaded the track. Compare match artist names against the uploader's handle/display name — variations count (e.g. handle `knock2one.bsky.social` matching artist `knock2one`). If the majority of matches are self-matches with score 0, this is a clear false positive.

**Recommendation:** resolve as `ORIGINAL_ARTIST`

### (add more patterns here as they're encountered)

## 3. Present recommendations

Use `AskUserQuestion` to present findings. For each flag, show:
- track title and artist
- what the matches look like (brief summary, not the full list)
- your classification and confidence
- recommended action

Let the user confirm, modify, or skip each recommendation before taking any action.

## 4. Execute confirmed actions

For flags the user confirms should be resolved:

**If a label exists in the moderation service:**
```bash
source .env && curl -s -X POST "https://moderation.plyr.fm/admin/resolve" \
  -H "X-Moderation-Key: ${MODERATION_AUTH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"uri":"<ATPROTO_URI>","val":"copyright-violation","reason":"<REASON>","notes":"<notes>"}'
```

Valid reasons: `ORIGINAL_ARTIST`, `LICENSED`, `FINGERPRINT_NOISE`, `COVER_VERSION`, `OTHER`, `content_deleted`

**If no label exists** (scan is in DB but moderation service has no label), just report that no action is needed — the system already handled it correctly.

**If the user wants to escalate**, suggest running the moderation loop: `uv run scripts/moderation_loop.py --env prod`
