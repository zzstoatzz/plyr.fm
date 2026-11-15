CREATE TABLE plyr_index.legacy_track_links (
    legacy_id INTEGER PRIMARY KEY CHECK (legacy_id > 0),
    record_uri TEXT NOT NULL UNIQUE CHECK (record_uri ~ '^at://did:[^/]+/[^/]+/[^/]+$')
);
