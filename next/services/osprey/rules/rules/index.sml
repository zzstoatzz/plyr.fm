Import(rules=['models/track.sml'])

# Prod fingerprints every upload, and next already reads prod's verdicts
# through the labeler, so until next replaces prod only audio that next itself
# stored (uploads made on next.plyr.fm) is scanned here: scans cost money.
# At cutover, require the copyright rules for every track.
NextUpload = AudioHost == 'plyr-next-audio.n8-3e9.workers.dev'

Require(rule='rules/copyright.sml', require_if=NextUpload and not ScannedBefore)
