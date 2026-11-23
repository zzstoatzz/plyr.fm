-- Covers were never checked before the rules worker's covers walk existed
-- (#2916), whose first run started at merge time. Rewind that walk once so
-- every cover already in the index is checked too; each check is recorded in
-- plyr_moderation.image_scans, so nothing is paid for twice.
UPDATE plyr_moderation.rule_cursors
SET indexed_at_us = 0, record_uri = '', attempts = 0, updated_at = clock_timestamp()
WHERE name = 'covers';
