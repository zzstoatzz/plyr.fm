## problem

the `/tracks/{track_id}/play` endpoint (src/relay/api/tracks.py:432-448) is unauthenticated and has no throttling, making it trivial to artificially inflate play counts via automated scripts. since play counts are a primary engagement metric, this threatens platform integrity.

## abuse patterns to prevent

- bot networks generating artificial plays
- automated scripts looping tracks
- multiple account creation for metric inflation
- coordinated fraud campaigns

## recommended technical approach

### phase 1: foundational measures (immediate)

1. **minimum play duration validation** (industry standard: 30 seconds)
   - require client to call endpoint after 30s of confirmed playback
   - prevents rapid-fire automated increments

2. **rate limiting**
   - per IP: 100 plays/hour (token bucket algorithm)
   - per authenticated user: 500 plays/day
   - use `slowapi` middleware for implementation

3. **authentication requirement**
   - require valid session for play count increments
   - enables per-user tracking and quotas
   - tie plays to DIDs for cross-reference

### phase 2: advanced detection (future)

4. **lightweight device fingerprinting**
   - collect: user agent, screen size, timezone, language
   - identify duplicate devices without sophisticated tracking

5. **engagement metrics**
   - track beyond raw plays: likes, shares, playlist adds, listener retention
   - flag accounts with suspicious play-to-engagement ratios

6. **behavioral analysis**
   - identify non-human patterns (no breaks, geographic anomalies)
   - ML models if scale demands (platform-wide fraud detection)

## implementation notes

- start conservatively - prioritize monitoring over blocking
- consider async validation: count initially, flag for review
- avoid false positives (<0.01% industry benchmark)
- implement exponential backoff on suspicious activity

## references

- spotify uses 30-second threshold + financial penalties (€10/month per fraudulent track)
- soundcloud partnered with DataDome for real-time bot detection
- deezer caps individual accounts at 1,000 streams
- music fights fraud alliance (2023) shares cross-platform fraud data

## priority

**high** - directly impacts platform credibility and artist revenue fairness
