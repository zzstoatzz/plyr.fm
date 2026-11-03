-- Optional plyr display name on the authored profile record (stg/next-only
-- field, not in the published fm.plyr.actor.profile lexicon). When present it
-- wins over the bsky display name in actor_identities.
ALTER TABLE plyr_index.profile_records ADD COLUMN display_name TEXT;
