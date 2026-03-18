# copyright detection rules
#
# signals come from AudD with accurate_offsets=1:
# - DominantMatchPct: % of audio segments matching the same song
# - MatchCount: number of distinct segment matches
#
# note: highest_score is always 0 with accurate_offsets — do NOT use it.
#
# the existing Rust moderation service flags at its configured threshold
# (default 30% dominant match) and DMs the admin. Osprey adds label
# emission on top of that existing flow.

Import(rules=['models/copyright.sml'])

# high-confidence: dominant match covers 85%+ of audio segments
HighConfidenceCopyright = Rule(
  when_all=[
    DominantMatchPct >= 85,
  ],
  description='dominant match covers 85%+ of audio',
)

# moderate-confidence: 50%+ dominant match with multiple segment matches
ModerateConfidenceCopyright = Rule(
  when_all=[
    DominantMatchPct >= 50,
    MatchCount >= 3,
  ],
  description='50%+ dominant match with 3+ segment matches',
)

# high confidence → auto-emit copyright-violation label
WhenRules(
  rules_any=[HighConfidenceCopyright],
  then=[
    LabelAdd(entity=TrackAtUri, label='copyright-violation'),
  ],
)

# moderate confidence → emit copyright-review label for manual review
WhenRules(
  rules_any=[ModerateConfidenceCopyright],
  then=[
    LabelAdd(entity=TrackAtUri, label='copyright-review'),
  ],
)
