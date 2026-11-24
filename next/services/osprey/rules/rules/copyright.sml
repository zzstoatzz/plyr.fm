Import(rules=['models/track.sml'])

# A scan is paid for from the uploader's daily scan budget (and everyone's
# together). Out of budget, the track is held out of discovery until it can be.
ScanGranted: bool = SpendScanBudget(
  audio_url=ResolveOptional(optional_value=AudioUrl, default_value=''),
  owner_did=OwnerDid,
  duration_seconds=DurationSeconds,
)

Require(rule='rules/fingerprint.sml', require_if=ScanGranted)

OutOfScanBudget = Rule(
  when_all=[ScanGranted == False],
  description='the scan budget for the uploader, or for everyone, is spent for the day',
)

WhenRules(
  rules_any=[OutOfScanBudget],
  then=[HoldForScan(subject=Track)],
)
