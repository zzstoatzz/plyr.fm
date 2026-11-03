-- Records ingested from a jetstream (zat stream) carry a commit rev and the
-- record CID but no commit CID: the stream verifies commits upstream and does
-- not forward proofs. Snapshot repair from a PDS still records its commit CID.
ALTER TABLE plyr_index.list_records ALTER COLUMN commit_cid DROP NOT NULL;
ALTER TABLE plyr_index.track_records ALTER COLUMN commit_cid DROP NOT NULL;
ALTER TABLE plyr_index.profile_records ALTER COLUMN commit_cid DROP NOT NULL;
ALTER TABLE plyr_index.like_records ALTER COLUMN commit_cid DROP NOT NULL;
ALTER TABLE plyr_index.record_rejections ALTER COLUMN commit_cid DROP NOT NULL;
