# copyright scan result features
#
# AudD with accurate_offsets=1 does NOT return confidence scores.
# highest_score is always 0. the only meaningful signals are:
# - dominant_match_pct: % of audio segments matching the same song
# - match_count: number of distinct segment matches

Import(rules=['models/base.sml'])

DominantMatchPct = JsonData(path='$.scan.dominant_match_pct', coerce_type=True, required=False)
MatchCount = JsonData(path='$.scan.match_count', coerce_type=True, required=False)
DominantMatch = JsonData(path='$.scan.dominant_match', required=False)
