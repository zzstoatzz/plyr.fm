-- converted from alembic revision b58f2a7c91d4 (add_projection_search_indexes) on codex/zig-backend

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX ix_plyr_index_track_records_title_trgm ON plyr_index.track_records USING gin (title gin_trgm_ops) WHERE NOT deleted;

CREATE INDEX ix_plyr_index_list_records_name_trgm ON plyr_index.list_records USING gin (name gin_trgm_ops) WHERE NOT deleted AND name IS NOT NULL;
