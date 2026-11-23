Import(rules=['models/track.sml'])

# Audio next holds is scanned however the record got there: an upload on
# next.plyr.fm, or a record written straight to its PDS, whose blob next copies
# (and checks against its CID) before playing it; AudioUrl is then that copy.
# Prod's own uploads (audio.plyr.fm) are left to prod's scan, whose verdicts
# next reads through the labeler, until cutover: scans cost money.
NextUpload = AudioHost == 'plyr-next-audio.n8-3e9.workers.dev'

Require(rule='rules/copyright.sml', require_if=NextUpload and not ScannedBefore)
