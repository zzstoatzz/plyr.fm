-- converted from alembic revision f93c4e1a6b05 (index_exact_subject_likes) on codex/zig-backend

DROP INDEX plyr_index.ix_like_records_subject_live;

CREATE INDEX ix_like_records_subject_live ON plyr_index.like_records (subject_uri, subject_cid, record_created_at DESC, record_uri DESC) WHERE NOT deleted;
