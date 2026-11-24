Import(rules=['models/track.sml'])

# An account uploading at volume (a script, an agent) is one review of the
# account, not one per track: the flag lands on the account at 20, 100 and 500
# tracks in a day, and an operator answers once (the `ai` account label, or a
# takedown).
UploadBurst = Rule(
  when_all=[RecentUploads == 20 or RecentUploads == 100 or RecentUploads == 500],
  description='many tracks from one account in a day',
)

WhenRules(
  rules_any=[UploadBurst],
  then=[
    FlagForReview(subject=Owner, source='rule', name='volume', evidence=[f'{RecentUploads} tracks in a day']),
  ],
)
