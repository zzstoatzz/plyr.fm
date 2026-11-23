Import(rules=['models/track.sml'])

# Audio next holds is scanned however the record got there: an upload on
# next.plyr.fm, or a record written straight to its PDS, whose blob next copies
# (and checks against its CID) before playing it; AudioUrl is then that copy.
# Prod's own uploads (audio.plyr.fm) are left to prod's scan, whose verdicts
# next reads through the labeler, until cutover: scans cost money.
NextUpload = AudioHost == 'plyr-next-audio.n8-3e9.workers.dev'

Require(rule='rules/copyright.sml', require_if=ActionName == 'track' and NextUpload and not ScannedBefore)

# Every cover next shows is checked against plyr's image policy, from an upload
# or a record written straight to a PDS; prod's bucket holds only covers prod
# already checked when they were uploaded to it, so those have no CoverUrl.
HasCover = ResolveOptional(optional_value=CoverUrl, default_value='') != ''

Require(rule='rules/cover.sml', require_if=ActionName == 'cover' and HasCover and not ScannedBefore)
