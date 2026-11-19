# entry point. every action is a track the appview indexed (or re-indexed)
# from the network; see src/plyr_osprey/track_input.py for its shape.
Import(rules=['models/track.sml'])

Require(rule='rules/index.sml')
