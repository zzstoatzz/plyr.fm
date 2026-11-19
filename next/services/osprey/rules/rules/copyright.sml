Import(rules=['models/track.sml'])

# Someone else's recording plays through the upload for about 48 seconds, or
# fills most of it. The uploader's own catalog doesn't count.
Recordings: List[str] = RecordingsPlayingThrough(
  audio_url=ResolveOptional(optional_value=AudioUrl, default_value=''),
  owner_handle=OwnerHandle,
  owner_name=OwnerName,
)

CopyrightPlaysThrough = Rule(
  when_all=[ListLength(list=Recordings) > 0],
  description="someone else's recording plays through the upload",
)

WhenRules(
  rules_any=[CopyrightPlaysThrough],
  then=[
    FlagForReview(subject=Track, source='scan', name='audd', evidence=Recordings),
  ],
)
