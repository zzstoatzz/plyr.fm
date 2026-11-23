-- A closed track's public record names the space that holds its audio
-- (audioSpace) and carries no audioUrl or audioBlob. The shape check from 0004
-- predates closing and refused those rows, so the ingester stopped on the first
-- closed track it saw and replayed it forever. A live track now needs one of
-- the three audio sources, the same rule the record parser applies.
ALTER TABLE plyr_index.track_records DROP CONSTRAINT ck_track_records_tombstone_shape;
ALTER TABLE plyr_index.track_records ADD CONSTRAINT ck_track_records_tombstone_shape CHECK (
    (deleted AND record_cid IS NULL AND title IS NULL AND artist_name IS NULL
        AND file_type IS NULL AND record_created_at IS NULL
        AND audio_url IS NULL AND audio_blob_cid IS NULL
        AND cardinality(featured_dids) = 0 AND cardinality(self_labels) = 0)
    OR (NOT deleted AND record_cid IS NOT NULL AND title IS NOT NULL
        AND artist_name IS NOT NULL AND file_type IS NOT NULL
        AND record_created_at IS NOT NULL
        AND (audio_url IS NOT NULL OR audio_blob_cid IS NOT NULL OR audio_space IS NOT NULL))
);
