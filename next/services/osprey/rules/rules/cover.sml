Import(rules=['models/track.sml'])

# A cover breaks plyr's image policy (the check prod runs on covers uploaded
# to it), whether it came with an upload or a record written straight to a PDS.
CoverViolations: List[str] = ImagePolicyViolations(
  image_url=ResolveOptional(optional_value=CoverUrl, default_value=''),
)

CoverBreaksImagePolicy = Rule(
  when_all=[ListLength(list=CoverViolations) > 0],
  description="the cover breaks plyr's image policy",
)

WhenRules(
  rules_any=[CoverBreaksImagePolicy],
  then=[
    FlagForReview(subject=Track, source='scan', name='cover', evidence=CoverViolations),
  ],
)
