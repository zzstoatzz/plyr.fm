//! Atomic PostgreSQL persistence for verified list-record projections.

const std = @import("std");
const pg = @import("pg");
const postgres_test_lock = @import("../testing/postgres_lock.zig");
const zat = @import("zat");
const list_change = @import("list_change.zig");
const list_store = @import("list_store.zig");

const ApplyResult = list_store.ApplyResult;
const ListStore = list_store.ListStore;

pub const PostgresListStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresListStore) ListStore {
        return .{ .context = self, .apply_fn = applyOpaque };
    }

    fn applyOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        change: list_change.Change,
    ) ListStore.Error!ApplyResult {
        const self: *PostgresListStore = @ptrCast(@alignCast(context));
        return self.apply(allocator, change);
    }

    fn apply(
        self: *PostgresListStore,
        allocator: std.mem.Allocator,
        change: list_change.Change,
    ) ListStore.Error!ApplyResult {
        var conn = self.pool.acquire() catch |err| {
            std.log.err("list projection connection acquisition failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        defer self.pool.release(conn);
        conn.begin() catch |err| {
            std.log.err("list projection transaction begin failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        errdefer conn.rollback() catch |err| {
            std.log.err("list projection rollback failed: {}", .{err});
        };

        const result = try self.applyInTransaction(conn, allocator, change);
        conn.commit() catch |err| {
            std.log.err("list projection commit failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        return result;
    }

    /// Apply one list change using a transaction owned by the caller.
    ///
    /// The verified-commit sink uses this boundary so every selected operation
    /// and the repository chain head become visible in one database commit.
    pub fn applyInTransaction(
        self: *PostgresListStore,
        conn: *pg.Conn,
        allocator: std.mem.Allocator,
        change: list_change.Change,
    ) ListStore.Error!ApplyResult {
        return switch (change) {
            .upsert => |upsert| try self.applyUpsert(conn, allocator, upsert),
            .delete => |delete| try self.applyDelete(conn, allocator, delete),
        };
    }

    fn applyUpsert(
        _: *PostgresListStore,
        conn: *pg.Conn,
        allocator: std.mem.Allocator,
        change: list_change.Upsert,
    ) ListStore.Error!ApplyResult {
        const commit_cid = change.proof.commit_cid.toString(allocator) catch
            return error.OutOfMemory;
        defer allocator.free(commit_cid);
        const result = try applyRecord(conn, .{
            .record_uri = change.record_uri,
            .record_cid = change.record_cid,
            .owner_did = change.owner_did,
            .collection = change.collection,
            .rkey = change.rkey,
            .list_type = @tagName(change.list_type),
            .name = change.name,
            .created_at = change.created_at,
            .updated_at = change.updated_at,
            .deleted = false,
            .commit_cid = commit_cid,
            .commit_rev = change.proof.commit_rev,
            .indexed_at_us = change.proof.indexed_at_us,
        });
        if (result != .applied) return result;
        try replaceMembers(conn, allocator, change.record_uri, change.members);
        return .applied;
    }

    fn applyDelete(
        _: *PostgresListStore,
        conn: *pg.Conn,
        allocator: std.mem.Allocator,
        change: list_change.Delete,
    ) ListStore.Error!ApplyResult {
        const commit_cid = change.proof.commit_cid.toString(allocator) catch
            return error.OutOfMemory;
        defer allocator.free(commit_cid);
        const result = try applyRecord(conn, .{
            .record_uri = change.record_uri,
            .record_cid = null,
            .owner_did = change.owner_did,
            .collection = change.collection,
            .rkey = change.rkey,
            .list_type = null,
            .name = null,
            .created_at = null,
            .updated_at = null,
            .deleted = true,
            .commit_cid = commit_cid,
            .commit_rev = change.proof.commit_rev,
            .indexed_at_us = change.proof.indexed_at_us,
        });
        if (result != .applied) return result;
        try replaceMembers(conn, allocator, change.record_uri, &.{});
        return .applied;
    }
};

const RecordWrite = struct {
    record_uri: []const u8,
    record_cid: ?[]const u8,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    list_type: ?[]const u8,
    name: ?[]const u8,
    created_at: ?[]const u8,
    updated_at: ?[]const u8,
    deleted: bool,
    commit_cid: []const u8,
    commit_rev: []const u8,
    indexed_at_us: i64,
};

fn applyRecord(conn: *pg.Conn, write: RecordWrite) ListStore.Error!ApplyResult {
    const affected = conn.exec(upsert_record_sql, .{
        write.record_uri,
        write.record_cid,
        write.owner_did,
        write.collection,
        write.rkey,
        write.list_type,
        write.name,
        write.created_at,
        write.updated_at,
        write.deleted,
        write.commit_cid,
        write.commit_rev,
        write.indexed_at_us,
    }) catch |err| {
        std.log.err("list projection record upsert failed: {}", .{err});
        return error.ProjectionUnavailable;
    };
    if (affected == 1) return .applied;
    if (affected != 0) return error.CorruptProjection;
    return classifyReplay(conn, write);
}

fn classifyReplay(conn: *pg.Conn, write: RecordWrite) ListStore.Error!ApplyResult {
    var current = conn.row(classify_replay_sql, .{write.record_uri}) catch |err| {
        std.log.err("list projection replay classification failed: {}", .{err});
        return error.ProjectionUnavailable;
    } orelse return error.CorruptProjection;
    defer current.deinit() catch |err| {
        std.log.err("list projection replay cleanup failed: {}", .{err});
    };

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

fn replaceMembers(
    conn: *pg.Conn,
    allocator: std.mem.Allocator,
    record_uri: []const u8,
    members: []const list_change.Member,
) ListStore.Error!void {
    const deleted = conn.exec(delete_members_sql, .{record_uri}) catch |err| {
        std.log.err("list projection member deletion failed: {}", .{err});
        return error.ProjectionUnavailable;
    };
    _ = deleted;
    if (members.len == 0) return;

    const positions = allocator.alloc(i16, members.len) catch return error.OutOfMemory;
    defer allocator.free(positions);
    const track_uris = allocator.alloc([]const u8, members.len) catch return error.OutOfMemory;
    defer allocator.free(track_uris);
    const track_cids = allocator.alloc([]const u8, members.len) catch return error.OutOfMemory;
    defer allocator.free(track_cids);
    for (members, 0..) |member, index| {
        positions[index] = @intCast(member.position);
        track_uris[index] = member.track_uri;
        track_cids[index] = member.track_cid;
    }

    const inserted = conn.exec(insert_members_sql, .{
        record_uri,
        positions,
        track_uris,
        track_cids,
    }) catch |err| {
        std.log.err("list projection member replacement failed: {}", .{err});
        return error.ProjectionUnavailable;
    };
    if (inserted != @as(i64, @intCast(members.len))) return error.CorruptProjection;
}

fn optionalEql(left: ?[]const u8, right: ?[]const u8) bool {
    if (left == null or right == null) return left == null and right == null;
    return std.mem.eql(u8, left.?, right.?);
}

const upsert_record_sql =
    \\INSERT INTO plyr_index.list_records (
    \\  record_uri, record_cid, owner_did, collection, rkey, list_type, name,
    \\  record_created_at, record_updated_at, deleted, commit_cid, commit_rev,
    \\  indexed_at_us
    \\) VALUES (
    \\  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
    \\)
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  record_cid = EXCLUDED.record_cid,
    \\  owner_did = EXCLUDED.owner_did,
    \\  collection = EXCLUDED.collection,
    \\  rkey = EXCLUDED.rkey,
    \\  list_type = EXCLUDED.list_type,
    \\  name = EXCLUDED.name,
    \\  record_created_at = EXCLUDED.record_created_at,
    \\  record_updated_at = EXCLUDED.record_updated_at,
    \\  deleted = EXCLUDED.deleted,
    \\  commit_cid = EXCLUDED.commit_cid,
    \\  commit_rev = EXCLUDED.commit_rev,
    \\  indexed_at_us = EXCLUDED.indexed_at_us
    \\WHERE plyr_index.list_records.commit_rev < EXCLUDED.commit_rev
;

const classify_replay_sql =
    \\SELECT commit_rev, commit_cid, deleted, record_cid
    \\FROM plyr_index.list_records
    \\WHERE record_uri = $1
;

const delete_members_sql =
    \\DELETE FROM plyr_index.list_members WHERE list_uri = $1
;

const insert_members_sql =
    \\INSERT INTO plyr_index.list_members (list_uri, position, track_uri, track_cid)
    \\SELECT $1, member.position, member.track_uri, member.track_cid
    \\FROM unnest($2::smallint[], $3::text[], $4::text[])
    \\  AS member(position, track_uri, track_cid)
;

test "PostgreSQL list projection is atomic and replay safe" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const database_url = std.mem.span(url_z);
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const uri = try std.Uri.parse(database_url);
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();

    var database_row = (try pool.row("SELECT current_database()", .{})).?;
    const database_name = try allocator.dupe(u8, try database_row.get([]const u8, 0));
    defer allocator.free(database_name);
    try database_row.deinit();
    if (!std.mem.eql(u8, database_name, "zig_test")) return error.UnsafeTestDatabase;

    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    try createTestSchema(pool);

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var store_impl: PostgresListStore = .{ .pool = pool };
    const store = store_impl.store();

    const record_uri = "at://did:plc:artist/fm.plyr.dev.list/3m123abc";
    const track_a = "at://did:plc:artist/fm.plyr.dev.track/a";
    const track_b = "at://did:plc:artist/fm.plyr.dev.track/b";
    const track_cid = try cidString(a, "track");
    const record_cid_1 = try cidString(a, "record-1");
    const record_cid_2 = try cidString(a, "record-2");
    const record_cid_3 = try cidString(a, "record-3");
    const commit_1 = try zat.Cid.forDagCbor(a, "commit-1");
    const commit_2 = try zat.Cid.forDagCbor(a, "commit-2");
    const commit_3 = try zat.Cid.forDagCbor(a, "commit-3");
    const commit_4 = try zat.Cid.forDagCbor(a, "commit-4");
    var tid_1 = zat.Tid.fromTimestamp(1_000, 1);
    var tid_2 = zat.Tid.fromTimestamp(2_000, 1);
    var tid_3 = zat.Tid.fromTimestamp(3_000, 1);
    var tid_4 = zat.Tid.fromTimestamp(4_000, 1);

    const members_1 = [_]list_change.Member{
        .{ .position = 0, .track_uri = track_a, .track_cid = track_cid },
        .{ .position = 1, .track_uri = track_b, .track_cid = track_cid },
    };
    const change_1 = listUpsert(record_uri, record_cid_1, tid_1.str(), commit_1, &members_1);
    try std.testing.expectEqual(ApplyResult.applied, try store.apply(a, change_1));
    try std.testing.expectEqual(ApplyResult.idempotent, try store.apply(a, change_1));
    try expectMembers(pool, record_uri, &.{ track_a, track_b });

    const members_2 = [_]list_change.Member{
        .{ .position = 0, .track_uri = track_b, .track_cid = track_cid },
        .{ .position = 1, .track_uri = track_a, .track_cid = track_cid },
    };
    const change_2 = listUpsert(record_uri, record_cid_2, tid_2.str(), commit_2, &members_2);
    try std.testing.expectEqual(ApplyResult.applied, try store.apply(a, change_2));
    try std.testing.expectEqual(ApplyResult.stale, try store.apply(a, change_1));
    try expectMembers(pool, record_uri, &.{ track_b, track_a });

    const conflicting = listUpsert(record_uri, record_cid_3, tid_2.str(), commit_3, &members_1);
    try std.testing.expectError(error.RevisionConflict, store.apply(a, conflicting));

    const rejected_members = try a.alloc(list_change.Member, 64);
    for (rejected_members, 0..) |*member, index| member.* = .{
        .position = @intCast(index),
        .track_uri = track_a,
        .track_cid = track_cid,
    };
    const rejected = listUpsert(record_uri, record_cid_3, tid_3.str(), commit_3, rejected_members);
    var constrained_memory: [96]u8 = undefined;
    var constrained = std.heap.FixedBufferAllocator.init(&constrained_memory);
    try std.testing.expectError(error.OutOfMemory, store.apply(constrained.allocator(), rejected));
    try expectRecord(pool, record_uri, record_cid_2, tid_2.str(), false);
    try expectMembers(pool, record_uri, &.{ track_b, track_a });

    const deletion: list_change.Change = .{ .delete = .{
        .record_uri = record_uri,
        .owner_did = "did:plc:artist",
        .collection = "fm.plyr.dev.list",
        .rkey = "3m123abc",
        .proof = .{
            .commit_cid = commit_4,
            .commit_rev = tid_4.str(),
            .indexed_at_us = 4_000,
        },
    } };
    try std.testing.expectEqual(ApplyResult.applied, try store.apply(a, deletion));
    try std.testing.expectEqual(ApplyResult.idempotent, try store.apply(a, deletion));
    try std.testing.expectEqual(ApplyResult.stale, try store.apply(a, change_2));
    try expectRecord(pool, record_uri, null, tid_4.str(), true);
    try expectMembers(pool, record_uri, &.{});
}

fn listUpsert(
    record_uri: []const u8,
    record_cid: []const u8,
    commit_rev: []const u8,
    commit_cid: zat.Cid,
    members: []const list_change.Member,
) list_change.Change {
    return .{ .upsert = .{
        .record_uri = record_uri,
        .record_cid = record_cid,
        .owner_did = "did:plc:artist",
        .collection = "fm.plyr.dev.list",
        .rkey = "3m123abc",
        .list_type = .album,
        .name = "Album",
        .created_at = "2026-08-08T12:00:00Z",
        .updated_at = null,
        .members = members,
        .proof = .{
            .commit_cid = commit_cid,
            .commit_rev = commit_rev,
            .indexed_at_us = 1,
        },
    } };
}

fn cidString(allocator: std.mem.Allocator, seed: []const u8) ![]const u8 {
    const cid = try zat.Cid.forDagCbor(allocator, seed);
    return cid.toString(allocator);
}

pub fn createTestSchema(pool: *pg.Pool) !void {
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.list_records (
        \\  record_uri text PRIMARY KEY,
        \\  record_cid text,
        \\  owner_did text NOT NULL,
        \\  collection text NOT NULL,
        \\  rkey text NOT NULL,
        \\  list_type text,
        \\  name text,
        \\  record_created_at text,
        \\  record_updated_at text,
        \\  deleted boolean NOT NULL,
        \\  commit_cid text NOT NULL,
        \\  commit_rev text NOT NULL,
        \\  indexed_at_us bigint NOT NULL,
        \\  CONSTRAINT ck_list_records_canonical_uri CHECK (
        \\    record_uri = 'at://' || owner_did || '/' || collection || '/' || rkey
        \\  ),
        \\  CONSTRAINT ck_list_records_tombstone_shape CHECK (
        \\    (deleted AND record_cid IS NULL AND list_type IS NULL
        \\      AND record_created_at IS NULL AND record_updated_at IS NULL)
        \\    OR (NOT deleted AND record_cid IS NOT NULL
        \\      AND list_type IS NOT NULL AND record_created_at IS NOT NULL)
        \\  ),
        \\  CONSTRAINT ck_list_records_type CHECK (
        \\    deleted OR list_type IN ('album', 'playlist', 'liked')
        \\  ),
        \\  CONSTRAINT ck_list_records_indexed_at CHECK (indexed_at_us >= 0),
        \\  CONSTRAINT uq_list_records_repo_path UNIQUE (owner_did, collection, rkey)
        \\)
    , .{});
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.list_members (
        \\  list_uri text NOT NULL REFERENCES plyr_index.list_records(record_uri)
        \\    ON DELETE CASCADE,
        \\  position smallint NOT NULL CHECK (position >= 0),
        \\  track_uri text NOT NULL,
        \\  track_cid text NOT NULL,
        \\  PRIMARY KEY (list_uri, position)
        \\)
    , .{});
}

fn expectRecord(
    pool: *pg.Pool,
    record_uri: []const u8,
    record_cid: ?[]const u8,
    commit_rev: []const u8,
    deleted: bool,
) !void {
    var row = (try pool.row(
        "SELECT record_cid, commit_rev, deleted FROM plyr_index.list_records WHERE record_uri = $1",
        .{record_uri},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expect(optionalEql(try row.get(?[]const u8, 0), record_cid));
    try std.testing.expectEqualStrings(commit_rev, try row.get([]const u8, 1));
    try std.testing.expectEqual(deleted, try row.get(bool, 2));
}

fn expectMembers(
    pool: *pg.Pool,
    record_uri: []const u8,
    expected: []const []const u8,
) !void {
    var result = try pool.query(
        "SELECT track_uri FROM plyr_index.list_members WHERE list_uri = $1 ORDER BY position",
        .{record_uri},
    );
    defer result.deinit();
    var index: usize = 0;
    while (try result.next()) |row| : (index += 1) {
        try std.testing.expect(index < expected.len);
        try std.testing.expectEqualStrings(expected[index], try row.get([]const u8, 0));
    }
    try std.testing.expectEqual(expected.len, index);
}
