# user blocklist rules (placeholder for phase 3)

Import(rules=['models/base.sml'])

UserIsBlocked = HasLabel(entity=ArtistDid, label='blocked')

WhenRules(
  rules_any=[UserIsBlocked],
  then=[
    DeclareVerdict(verdict='reject'),
  ],
)
