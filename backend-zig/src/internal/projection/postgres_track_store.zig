//! Atomic PostgreSQL persistence for verified track-record projections.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const track_change = @import("track_change.zig");
const track_store = @import("track_store.zig");

const ApplyResult = track_store.ApplyResult;
const TrackStore = track_store.TrackStore;

pub const PostgresTrackStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresTrackStore) TrackStore {
        return .{ .context = self, .apply_fn = applyOpaque };
    }

    fn applyOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        change: track_change.Change,
    ) TrackStore.Error!ApplyResult {
        const self: *PostgresTrackStore = @ptrCast(@alignCast(context));
        return self.apply(allocator, change);
    }

    fn apply(
        self: *PostgresTrackStore,
        allocator: std.mem.Allocator,
        change: track_change.Change,
    ) TrackStore.Error!ApplyResult {
        var conn = self.pool.acquire() catch |err| {
            std.log.err("track projection connection acquisition failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        defer self.pool.release(conn);
        conn.begin() catch |err| {
            std.log.err("track projection transaction begin failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        errdefer conn.rollback() catch |err| {
            std.log.err("track projection rollback failed: {}", .{err});
        };
        const result = try self.applyInTransaction(conn, allocator, change);
        conn.commit() catch |err| {
            std.log.err("track projection commit failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        return result;
    }

    pub fn applyInTransaction(
        self: *PostgresTrackStore,
        conn: *pg.Conn,
        allocator: std.mem.Allocator,
        change: track_change.Change,
    ) TrackStore.Error!ApplyResult {
        return switch (change) {
            .upsert => |upsert| self.applyUpsert(conn, allocator, upsert),
            .delete => |delete| self.applyDelete(conn, allocator, delete),
        };
    }

    fn applyUpsert(
        _: *PostgresTrackStore,
        conn: *pg.Conn,
        allocator: std.mem.Allocator,
        change: track_change.Upsert,
    ) TrackStore.Error!ApplyResult {
        const commit_cid = change.proof.commit_cid.toString(allocator) catch
            return error.OutOfMemory;
        defer allocator.free(commit_cid);
        return applyRecord(conn, .{
            .record_uri = change.record_uri,
            .record_cid = change.record_cid,
            .owner_did = change.owner_did,
            .collection = change.collection,
            .rkey = change.rkey,
            .title = change.title,
            .artist_name = change.artist_name,
            .file_type = change.file_type,
            .record_created_at = change.created_at,
            .audio_url = change.audio_url,
            .audio_blob_cid = if (change.audio_blob) |blob| blob.cid else null,
            .audio_blob_media_type = if (change.audio_blob) |blob| blob.media_type else null,
            .audio_blob_size = if (change.audio_blob) |blob| @intCast(blob.size) else null,
            .album = change.album,
            .duration_seconds = if (change.duration_seconds) |duration| @intCast(duration) else null,
            .featured_dids = change.featured_dids,
            .image_url = change.image_url,
            .support_gate_type = change.support_gate_type,
            .description = change.description,
            .self_labels = change.self_labels,
            .deleted = false,
            .commit_cid = commit_cid,
            .commit_rev = change.proof.commit_rev,
            .indexed_at_us = change.proof.indexed_at_us,
        });
    }

    fn applyDelete(
        _: *PostgresTrackStore,
        conn: *pg.Conn,
        allocator: std.mem.Allocator,
        change: track_change.Delete,
    ) TrackStore.Error!ApplyResult {
        const commit_cid = change.proof.commit_cid.toString(allocator) catch
            return error.OutOfMemory;
        defer allocator.free(commit_cid);
        return applyRecord(conn, .{
            .record_uri = change.record_uri,
            .record_cid = null,
            .owner_did = change.owner_did,
            .collection = change.collection,
            .rkey = change.rkey,
            .title = null,
            .artist_name = null,
            .file_type = null,
            .record_created_at = null,
            .audio_url = null,
            .audio_blob_cid = null,
            .audio_blob_media_type = null,
            .audio_blob_size = null,
            .album = null,
            .duration_seconds = null,
            .featured_dids = &.{},
            .image_url = null,
            .support_gate_type = null,
            .description = null,
            .self_labels = &.{},
            .deleted = true,
            .commit_cid = commit_cid,
            .commit_rev = change.proof.commit_rev,
            .indexed_at_us = change.proof.indexed_at_us,
        });
    }
};

const RecordWrite = struct {
    record_uri: []const u8,
    record_cid: ?[]const u8,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    title: ?[]const u8,
    artist_name: ?[]const u8,
    file_type: ?[]const u8,
    record_created_at: ?[]const u8,
    audio_url: ?[]const u8,
    audio_blob_cid: ?[]const u8,
    audio_blob_media_type: ?[]const u8,
    audio_blob_size: ?i64,
    album: ?[]const u8,
    duration_seconds: ?i64,
    featured_dids: []const []const u8,
    image_url: ?[]const u8,
    support_gate_type: ?[]const u8,
    description: ?[]const u8,
    self_labels: []const []const u8,
    deleted: bool,
    commit_cid: []const u8,
    commit_rev: []const u8,
    indexed_at_us: i64,
};

fn applyRecord(conn: *pg.Conn, write: RecordWrite) TrackStore.Error!ApplyResult {
    const affected = conn.exec(upsert_record_sql, .{
        write.record_uri,
        write.record_cid,
        write.owner_did,
        write.collection,
        write.rkey,
        write.title,
        write.artist_name,
        write.file_type,
        write.record_created_at,
        write.audio_url,
        write.audio_blob_cid,
        write.audio_blob_media_type,
        write.audio_blob_size,
        write.album,
        write.duration_seconds,
        write.featured_dids,
        write.image_url,
        write.support_gate_type,
        write.description,
        write.self_labels,
        write.deleted,
        write.commit_cid,
        write.commit_rev,
        write.indexed_at_us,
    }) catch |err| {
        std.log.err("track projection record upsert failed: {}", .{err});
        return error.ProjectionUnavailable;
    };
    if (affected == 1) return .applied;
    if (affected != 0) return error.CorruptProjection;
    return classifyReplay(conn, write);
}

fn classifyReplay(conn: *pg.Conn, write: RecordWrite) TrackStore.Error!ApplyResult {
    var current = conn.row(classify_replay_sql, .{write.record_uri}) catch |err| {
        std.log.err("track projection replay classification failed: {}", .{err});
        return error.ProjectionUnavailable;
    } orelse return error.CorruptProjection;
    defer current.deinit() catch {};
    const current_rev = current.get([]const u8, 0) catch return error.CorruptProjection;
    switch (std.mem.order(u8, current_rev, write.commit_rev)) {
        .gt => return .stale,
        .lt => return error.CorruptProjection,
        .eq => {},
    }
    const current_commit = current.get([]const u8, 1) catch return error.CorruptProjection;
    const current_deleted = current.get(bool, 2) catch return error.CorruptProjection;
    const current_record = current.get(?[]const u8, 3) catch return error.CorruptProjection;
    if (!std.mem.eql(u8, current_commit, write.commit_cid) or
        current_deleted != write.deleted or !optionalEql(current_record, write.record_cid))
        return error.RevisionConflict;
    return .idempotent;
}

fn optionalEql(left: ?[]const u8, right: ?[]const u8) bool {
    if (left == null or right == null) return left == null and right == null;
    return std.mem.eql(u8, left.?, right.?);
}

const upsert_record_sql =
    \\INSERT INTO plyr_index.track_records (
    \\  record_uri, record_cid, owner_did, collection, rkey, title, artist_name,
    \\  file_type, record_created_at, audio_url, audio_blob_cid,
    \\  audio_blob_media_type, audio_blob_size, album, duration_seconds,
    \\  featured_dids, image_url, support_gate_type, description, self_labels,
    \\  deleted, commit_cid, commit_rev, indexed_at_us
    \\) VALUES (
    \\  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
    \\  $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
    \\)
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  record_cid = EXCLUDED.record_cid,
    \\  owner_did = EXCLUDED.owner_did,
    \\  collection = EXCLUDED.collection,
    \\  rkey = EXCLUDED.rkey,
    \\  title = EXCLUDED.title,
    \\  artist_name = EXCLUDED.artist_name,
    \\  file_type = EXCLUDED.file_type,
    \\  record_created_at = EXCLUDED.record_created_at,
    \\  audio_url = EXCLUDED.audio_url,
    \\  audio_blob_cid = EXCLUDED.audio_blob_cid,
    \\  audio_blob_media_type = EXCLUDED.audio_blob_media_type,
    \\  audio_blob_size = EXCLUDED.audio_blob_size,
    \\  album = EXCLUDED.album,
    \\  duration_seconds = EXCLUDED.duration_seconds,
    \\  featured_dids = EXCLUDED.featured_dids,
    \\  image_url = EXCLUDED.image_url,
    \\  support_gate_type = EXCLUDED.support_gate_type,
    \\  description = EXCLUDED.description,
    \\  self_labels = EXCLUDED.self_labels,
    \\  deleted = EXCLUDED.deleted,
    \\  commit_cid = EXCLUDED.commit_cid,
    \\  commit_rev = EXCLUDED.commit_rev,
    \\  indexed_at_us = EXCLUDED.indexed_at_us
    \\WHERE plyr_index.track_records.commit_rev < EXCLUDED.commit_rev
;

const classify_replay_sql =
    \\SELECT commit_rev, commit_cid, deleted, record_cid
    \\FROM plyr_index.track_records
    \\WHERE record_uri = $1
;

pub fn createTestTable(pool: *pg.Pool) !void {
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.track_records (
        \\  record_uri text PRIMARY KEY,
        \\  record_cid text,
        \\  owner_did text NOT NULL,
        \\  collection text NOT NULL,
        \\  rkey text NOT NULL,
        \\  title text,
        \\  artist_name text,
        \\  file_type text,
        \\  record_created_at text,
        \\  audio_url text,
        \\  audio_blob_cid text,
        \\  audio_blob_media_type text,
        \\  audio_blob_size bigint,
        \\  album text,
        \\  duration_seconds bigint,
        \\  featured_dids text[] NOT NULL DEFAULT '{}',
        \\  image_url text,
        \\  support_gate_type text,
        \\  description text,
        \\  self_labels text[] NOT NULL DEFAULT '{}',
        \\  deleted boolean NOT NULL,
        \\  commit_cid text NOT NULL,
        \\  commit_rev text NOT NULL,
        \\  indexed_at_us bigint NOT NULL,
        \\  CONSTRAINT ck_track_records_canonical_uri CHECK (
        \\    record_uri = 'at://' || owner_did || '/' || collection || '/' || rkey
        \\  ),
        \\  CONSTRAINT ck_track_records_tombstone_shape CHECK (
        \\    (deleted AND record_cid IS NULL AND title IS NULL AND artist_name IS NULL
        \\      AND file_type IS NULL AND record_created_at IS NULL
        \\      AND audio_url IS NULL AND audio_blob_cid IS NULL
        \\      AND cardinality(featured_dids) = 0 AND cardinality(self_labels) = 0)
        \\    OR (NOT deleted AND record_cid IS NOT NULL AND title IS NOT NULL
        \\      AND artist_name IS NOT NULL AND file_type IS NOT NULL
        \\      AND record_created_at IS NOT NULL
        \\      AND (audio_url IS NOT NULL OR audio_blob_cid IS NOT NULL))
        \\  ),
        \\  CONSTRAINT ck_track_records_blob_shape CHECK (
        \\    (audio_blob_cid IS NULL AND audio_blob_media_type IS NULL AND audio_blob_size IS NULL)
        \\    OR (audio_blob_cid IS NOT NULL AND audio_blob_media_type IS NOT NULL
        \\      AND audio_blob_size BETWEEN 0 AND 104857600)
        \\  ),
        \\  CONSTRAINT ck_track_records_duration CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
        \\  CONSTRAINT ck_track_records_features CHECK (cardinality(featured_dids) <= 10),
        \\  CONSTRAINT ck_track_records_labels CHECK (cardinality(self_labels) <= 10),
        \\  CONSTRAINT ck_track_records_indexed_at CHECK (indexed_at_us >= 0),
        \\  CONSTRAINT uq_track_records_repo_path UNIQUE (owner_did, collection, rkey)
        \\)
    , .{});
}

test "PostgreSQL track projection replaces complete records and keeps tombstones" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    try requireDisposableDatabase(pool, allocator);
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    try createTestTable(pool);

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var implementation: PostgresTrackStore = .{ .pool = pool };
    const store = implementation.store();
    const commit_1 = try zat.Cid.forDagCbor(a, "commit-1");
    const commit_2 = try zat.Cid.forDagCbor(a, "commit-2");
    const commit_3 = try zat.Cid.forDagCbor(a, "commit-3");
    const rev_1 = zat.Tid.fromTimestamp(1_000, 1);
    const rev_2 = zat.Tid.fromTimestamp(2_000, 1);
    const upsert_1 = makeUpsert(try cidString(a, "record-1"), "One", rev_1.str(), commit_1);
    try std.testing.expectEqual(ApplyResult.applied, try store.apply(a, upsert_1));
    try std.testing.expectEqual(ApplyResult.idempotent, try store.apply(a, upsert_1));
    try expectTrack(pool, "One", rev_1.str(), false);

    const upsert_2 = makeUpsert(try cidString(a, "record-2"), "Two", rev_2.str(), commit_2);
    try std.testing.expectEqual(ApplyResult.applied, try store.apply(a, upsert_2));
    try std.testing.expectEqual(ApplyResult.stale, try store.apply(a, upsert_1));
    try expectTrack(pool, "Two", rev_2.str(), false);

    const conflict = makeUpsert(try cidString(a, "record-3"), "Three", rev_2.str(), commit_3);
    try std.testing.expectError(error.RevisionConflict, store.apply(a, conflict));
    const deletion: track_change.Change = .{ .delete = .{
        .record_uri = "at://did:plc:artist/fm.plyr.dev.track/3m123abc",
        .owner_did = "did:plc:artist",
        .collection = "fm.plyr.dev.track",
        .rkey = "3m123abc",
        .proof = .{ .commit_cid = commit_3, .commit_rev = zat.Tid.fromTimestamp(3_000, 1).str(), .indexed_at_us = 3_000 },
    } };
    try std.testing.expectEqual(ApplyResult.applied, try store.apply(a, deletion));
    try expectTrack(pool, null, zat.Tid.fromTimestamp(3_000, 1).str(), true);
}

fn makeUpsert(record_cid: []const u8, title: []const u8, rev: []const u8, commit: zat.Cid) track_change.Change {
    return .{ .upsert = .{
        .record_uri = "at://did:plc:artist/fm.plyr.dev.track/3m123abc",
        .record_cid = record_cid,
        .owner_did = "did:plc:artist",
        .collection = "fm.plyr.dev.track",
        .rkey = "3m123abc",
        .title = title,
        .artist_name = "Artist",
        .file_type = "flac",
        .created_at = "2026-08-08T12:00:00Z",
        .audio_url = "https://media.example/one.flac",
        .audio_blob = null,
        .album = null,
        .duration_seconds = 42,
        .featured_dids = &.{"did:plc:featured"},
        .image_url = null,
        .support_gate_type = null,
        .description = null,
        .self_labels = &.{"porn"},
        .proof = .{ .commit_cid = commit, .commit_rev = rev, .indexed_at_us = 1 },
    } };
}

fn requireDisposableDatabase(pool: *pg.Pool, allocator: std.mem.Allocator) !void {
    var row = (try pool.row("SELECT current_database()", .{})).?;
    const name = try allocator.dupe(u8, try row.get([]const u8, 0));
    defer allocator.free(name);
    try row.deinit();
    if (!std.mem.eql(u8, name, "relay_test")) return error.UnsafeTestDatabase;
}

fn cidString(allocator: std.mem.Allocator, seed: []const u8) ![]const u8 {
    return (try zat.Cid.forDagCbor(allocator, seed)).toString(allocator);
}

fn expectTrack(pool: *pg.Pool, title: ?[]const u8, rev: []const u8, deleted: bool) !void {
    var row = (try pool.row(
        "SELECT title, commit_rev, deleted FROM plyr_index.track_records WHERE rkey = '3m123abc'",
        .{},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expect(optionalEql(try row.get(?[]const u8, 0), title));
    try std.testing.expectEqualStrings(rev, try row.get([]const u8, 1));
    try std.testing.expectEqual(deleted, try row.get(bool, 2));
}
