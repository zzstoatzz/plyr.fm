---
title: for_you
sidebarTitle: for_you
---

# `backend.api.for_you`


For You feed — collaborative filtering over user engagement edges.

Ports the scoring algorithm from grain.social's foryou.ts (originally tuned
by @spacecowboy17.bsky.social), adapted for plyr.fm in two ways:

1. **edges are not just likes**: a user "engages" with a track via a like OR
   a track_added_to_playlist event. both edges get weight 1.0 for v1.
2. **slower time decay**: audio ages slower than photo galleries, so we use
   a 48h half-life (grain uses 6h).

Scoring recipe per candidate track:
    score = (sum over paths of 1 / total_edges(coengager) ** DIVISOR_POWER)
            * paths ** SMOOTHING_FACTOR
            * 0.5 ** (age_hours / HALF_LIFE_HOURS)
            / popularity ** POPULARITY_PENALTY

Final output diversifies by artist (MAX_PER_ARTIST hard cap).


## Functions

### `get_for_you_feed` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/for_you.py#L272)

```python
get_for_you_feed(db: Annotated[AsyncSession, Depends(get_db)], auth_session: AuthSession = Depends(require_auth), cursor: str | None = Query(None), limit: int = Query(30, ge=1, le=50)) -> ForYouResponse
```


Personalized feed for the authenticated user.

Uses collaborative filtering over engagement edges (likes + playlist adds).
Falls back to cold-start (most-engaged last 30 days) if the user has no
taste signal yet.

Cursor is an integer offset into the materialized ranked list. Scores may
drift between pages — this is fine for v1; if it becomes annoying we can
cache the ranked list per-user in Redis.


## Classes

### `ForYouResponse` [source](https://github.com/zzstoatzz/plyr.fm/blob/main/backend/src/backend/api/for_you.py#L131)


Paginated For You feed.

