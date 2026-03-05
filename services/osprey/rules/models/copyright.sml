# copyright scan result features

Import(rules=['models/base.sml'])

CopyrightScore = JsonData(path='$.scan.highest_score', coerce_type=True, required=False)
DominantMatchPct = JsonData(path='$.scan.dominant_match_pct', coerce_type=True, required=False)
MatchCount = JsonData(path='$.scan.match_count', coerce_type=True, required=False)
DominantMatch = JsonData(path='$.scan.dominant_match', required=False)
