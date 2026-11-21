-- The legacy production catalog's play totals, as last imported by
-- scripts/import_legacy_plays. track_metrics.play_count holds this baseline
-- plus every play next has counted since, so a later import (the cutover's
-- final one) adds only the difference and never counts a play twice.
CREATE TABLE plyr_index.legacy_play_counts (
    record_uri TEXT PRIMARY KEY,
    play_count BIGINT NOT NULL CHECK (play_count >= 0),
    observed_at_us BIGINT NOT NULL CHECK (observed_at_us >= 0)
);
