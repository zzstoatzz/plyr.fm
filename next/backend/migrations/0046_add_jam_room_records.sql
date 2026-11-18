-- The last state of each shared Jam room, so a room that leaves Redis (its
-- 24-hour TTL, or a reset) comes back with its whole queue instead of the
-- one-track seed in the host's fm.plyr.next.jamState record. Keyed by the
-- room's space uri; written only by the Jam coordinator.
CREATE TABLE plyr_playback.jam_room_records (
    room TEXT PRIMARY KEY CHECK (room LIKE 'at://%' AND length(room) <= 2048),
    epoch TEXT NOT NULL CHECK (length(epoch) BETWEEN 1 AND 128),
    revision BIGINT NOT NULL CHECK (revision >= 0),
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
