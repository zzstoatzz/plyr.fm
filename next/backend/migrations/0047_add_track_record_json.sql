-- json, not jsonb: kept byte for byte as rendered, and jsonb refuses \u0000,
-- which atproto strings may carry.
ALTER TABLE plyr_index.track_records ADD COLUMN record_json json;
