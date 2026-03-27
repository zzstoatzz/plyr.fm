# sensitive image rules (placeholder for phase 3)

Import(rules=['models/image.sml'])

# flag images that failed the safety check
UnsafeImage = Rule(
  when_all=[
    ImageIsSafe == False,
  ],
  description='image flagged by content safety scan',
)

WhenRules(
  rules_any=[UnsafeImage],
  then=[
    LabelAdd(entity=TrackAtUri, label='sensitive-image'),
  ],
)
