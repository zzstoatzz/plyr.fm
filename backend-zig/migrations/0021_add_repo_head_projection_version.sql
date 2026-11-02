-- Records which decoder/projection version built each repository head, so a
-- complete snapshot at an unchanged revision is rebuilt (not skipped) after a
-- decoder fix. Existing heads start at 0 and are rebuilt by the next
-- reconciliation.
ALTER TABLE plyr_index.repo_heads
    ADD COLUMN projection_version INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_repo_heads_projection_version CHECK (projection_version >= 0);
