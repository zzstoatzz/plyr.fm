//! One query over the writers' checkpoints and the mirror's queue.

const std = @import("std");
const pg = @import("pg");
const store_module = @import("ingest_status_store.zig");
const mirror_store = @import("../delivery/postgres_mirror_store.zig");
const stream_runner = @import("../ingest/stream_runner.zig");
const catalog_reconcile_runner = @import("../ingest/catalog_reconcile_runner.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");

const IngestStatusStore = store_module.IngestStatusStore;

pub const PostgresIngestStatusStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresIngestStatusStore) IngestStatusStore {
        return .{ .context = self, .get_fn = getOpaque };
    }

    fn getOpaque(context: *anyopaque) IngestStatusStore.Error!store_module.Status {
        const self: *PostgresIngestStatusStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        var row = (conn.row(status_query, .{
            stream_runner.cursor_source,
            catalog_reconcile_runner.completed_source,
            @as(i64, @intCast(store_module.backlog_cap)),
        }) catch |err| {
            if (conn.err) |pg_err|
                std.log.err("ingest status query failed: {}: {s}", .{ err, pg_err.message })
            else
                std.log.err("ingest status query failed: {}", .{err});
            return error.IndexUnavailable;
        }) orelse return error.CorruptProjection;
        defer row.deinit() catch {};
        return .{
            .stream_cursor_us = row.get(?i64, 0) catch return error.CorruptProjection,
            .stream_checkpointed_at_us = row.get(?i64, 1) catch return error.CorruptProjection,
            .reconciled_at_us = row.get(?i64, 2) catch return error.CorruptProjection,
            .label_seq = row.get(?i64, 3) catch return error.CorruptProjection,
            .label_synced_at_us = row.get(?i64, 4) catch return error.CorruptProjection,
            .mirror_pending = std.math.cast(u64, row.get(i64, 5) catch return error.CorruptProjection) orelse
                return error.CorruptProjection,
            .mirror_retrying = std.math.cast(u64, row.get(i64, 6) catch return error.CorruptProjection) orelse
                return error.CorruptProjection,
        };
    }
};

const status_query =
    \\WITH stream AS (SELECT seq, updated_at_us FROM plyr_index.relay_cursors WHERE source = $1),
    \\reconcile AS (SELECT seq FROM plyr_index.relay_cursors WHERE source = $2),
    \\labels AS (
    \\  SELECT max(seq) AS seq, max(updated_at_us) AS updated_at_us
    \\  FROM plyr_index.relay_cursors WHERE source LIKE 'labels:%'
    \\),
    \\pending AS (
    \\  SELECT v.record_uri, v.record_cid
++ "\n" ++ mirror_store.pending_from ++ "\n" ++ mirror_store.pending_where ++ "\n" ++
    \\  LIMIT $3
    \\)
    \\SELECT (SELECT seq FROM stream), (SELECT updated_at_us FROM stream),
    \\  (SELECT seq FROM reconcile), (SELECT seq FROM labels), (SELECT updated_at_us FROM labels),
    \\  (SELECT count(*) FROM pending)::bigint,
    \\  (SELECT count(*) FROM pending JOIN plyr_index.track_mirror_attempts AS m
    \\    ON m.record_uri = pending.record_uri AND m.record_cid = pending.record_cid)::bigint
;

test "PostgreSQL ingest status reads every checkpoint and the mirror queue" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    {
        var row = (try pool.row("SELECT current_database()", .{})).?;
        defer row.deinit() catch {};
        if (!std.mem.eql(u8, try row.get([]const u8, 0), "zig_test")) return error.UnsafeTestDatabase;
    }
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.relay_cursors (
        \\  source text PRIMARY KEY, seq bigint NOT NULL, updated_at_us bigint NOT NULL
        \\)
    , .{});
    try @import("../projection/postgres_track_store.zig").createTestTable(pool);
    try @import("../account/postgres_availability_store.zig").createTestTable(pool);
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.track_delivery_origins (
        \\  record_uri text NOT NULL, service text NOT NULL, record_cid text NOT NULL,
        \\  origin_url text NOT NULL, media_type text NOT NULL, artifact_cid text NOT NULL,
        \\  verification text NOT NULL, observed_at_us bigint NOT NULL,
        \\  PRIMARY KEY (record_uri, service)
        \\)
    , .{});
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.track_mirror_attempts (
        \\  record_uri text PRIMARY KEY, record_cid text NOT NULL, attempts integer NOT NULL,
        \\  next_attempt_us bigint NOT NULL, last_error text NOT NULL
        \\)
    , .{});
    var implementation: PostgresIngestStatusStore = .{ .pool = pool };

    const empty = try implementation.store().get();
    try std.testing.expect(empty.stream_cursor_us == null and empty.reconciled_at_us == null and empty.label_seq == null);
    try std.testing.expectEqual(@as(u64, 0), empty.mirror_pending);

    _ = try pool.exec(
        \\INSERT INTO plyr_index.relay_cursors (source, seq, updated_at_us) VALUES
        \\  ('jetstream', 1000, 1100), ('catalog_reconcile', 900, 900),
        \\  ('labels:https://a.example', 7, 50), ('labels:https://b.example', 9, 40)
    , .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.account_availability (repo_did, available, evidence_source, pds_origin, observed_at_us)
        \\VALUES ('did:plc:a', true, 'current_pds', 'https://pds.example', 1)
    , .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.track_records (record_uri, record_cid, owner_did, collection, rkey, title,
        \\  artist_name, file_type, record_created_at, audio_url, audio_blob_cid, audio_blob_media_type,
        \\  audio_blob_size, deleted, commit_rev, indexed_at_us)
        \\SELECT 'at://did:plc:a/fm.plyr.dev.track/' || g, 'bafytrack' || g, 'did:plc:a', 'fm.plyr.dev.track',
        \\  g::text, 't', 'a', 'mp3', '2026-01-01T00:00:00Z',
        \\  CASE WHEN g = 3 THEN 'https://cdn.example/3.mp3' END, 'bafyblob' || g, 'audio/mpeg', 1,
        \\  false, '3jzfcijpj2z2a', 1
        \\FROM generate_series(1, 3) AS g
    , .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.track_mirror_attempts VALUES
        \\  ('at://did:plc:a/fm.plyr.dev.track/1', 'bafytrack1', 2, 0, 'timeout')
    , .{});

    const status = try implementation.store().get();
    try std.testing.expectEqual(@as(?i64, 1000), status.stream_cursor_us);
    try std.testing.expectEqual(@as(?i64, 1100), status.stream_checkpointed_at_us);
    try std.testing.expectEqual(@as(?i64, 900), status.reconciled_at_us);
    try std.testing.expectEqual(@as(?i64, 9), status.label_seq);
    try std.testing.expectEqual(@as(?i64, 50), status.label_synced_at_us);
    // track 3 plays from its https audioUrl, so the mirror skips it
    try std.testing.expectEqual(@as(u64, 2), status.mirror_pending);
    try std.testing.expectEqual(@as(u64, 1), status.mirror_retrying);
}
