# copyright detection rules
#
# thresholds match the existing moderation service config:
# - MODERATION_SCORE_THRESHOLD = 70 (in fly.toml)
# - dominant_match_pct >= 85 is high confidence

Import(rules=['models/copyright.sml'])

# high-confidence: dominant match covers 85%+ of audio segments
HighConfidenceCopyright = Rule(
  when_all=[
    DominantMatchPct >= 85,
  ],
  description='dominant match covers 85%+ of audio',
)

# medium-confidence: score above threshold with multiple matches
MediumConfidenceCopyright = Rule(
  when_all=[
    CopyrightScore >= 70,
    MatchCount >= 2,
    DominantMatchPct >= 50,
  ],
  description='multiple matches with moderate confidence',
)

# high confidence → label as copyright-violation
WhenRules(
  rules_any=[HighConfidenceCopyright],
  then=[
    LabelAdd(entity=TrackAtUri, label='copyright-violation'),
  ],
)

# medium confidence → label for review
WhenRules(
  rules_any=[MediumConfidenceCopyright],
  then=[
    LabelAdd(entity=TrackAtUri, label='copyright-review'),
  ],
)
