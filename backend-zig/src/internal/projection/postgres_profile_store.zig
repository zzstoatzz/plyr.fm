//! PostgreSQL adapter for verified authored profile records.

const std = @import("std");
const pg = @import("pg");
const postgres_test_lock = @import("../testing/postgres_lock.zig");
const zat = @import("zat");
const profile_change = @import("profile_change.zig");
const profile_store = @import("profile_store.zig");

const ApplyResult = profile_store.ApplyResult;
const ProfileStore = profile_store.ProfileStore;

pub const PostgresProfileStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresProfileStore) ProfileStore {
        return .{ .context = self, .apply_fn = applyOpaque };
    }

    fn applyOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        change: profile_change.Change,
    ) ProfileStore.Error!ApplyResult {
        const self: *PostgresProfileStore = @ptrCast(@alignCast(context));
        return self.apply(allocator, change);
    }

    fn apply(
        self: *PostgresProfileStore,
        allocator: std.mem.Allocator,
        change: profile_change.Change,
    ) ProfileStore.Error!ApplyResult {
        var conn = self.pool.acquire() catch |err| {
            std.log.err("profile projection connection acquisition failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        defer self.pool.release(conn);
        conn.begin() catch |err| {
            std.log.err("profile projection transaction begin failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        errdefer conn.rollback() catch |err| {
            std.log.err("profile projection rollback failed: {}", .{err});
        };
        const result = try self.applyInTransaction(conn, allocator, change);
        conn.commit() catch |err| {
            std.log.err("profile projection commit failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        return result;
    }

    pub fn applyInTransaction(
        _: *PostgresProfileStore,
        conn: *pg.Conn,
        allocator: std.mem.Allocator,
        change: profile_change.Change,
    ) ProfileStore.Error!ApplyResult {
        return switch (change) {
            .upsert => |upsert| applyUpsert(conn, allocator, upsert),
            .delete => |delete| applyDelete(conn, allocator, delete),
        };
    }
};

fn applyUpsert(
    conn: *pg.Conn,
    allocator: std.mem.Allocator,
    upsert: profile_change.Upsert,
) ProfileStore.Error!ApplyResult {
    const commit_cid = upsert.proof.commit_cid.toString(allocator) catch
        return error.OutOfMemory;
    defer allocator.free(commit_cid);
    return applyRecord(conn, .{
        .record_uri = upsert.record_uri,
        .record_cid = upsert.record_cid,
        .owner_did = upsert.owner_did,
        .collection = upsert.collection,
        .rkey = upsert.rkey,
        .avatar = upsert.avatar,
        .bio = upsert.bio,
        .record_created_at = upsert.created_at,
        .record_updated_at = upsert.updated_at,
        .deleted = false,
        .commit_cid = commit_cid,
        .commit_rev = upsert.proof.commit_rev,
        .indexed_at_us = upsert.proof.indexed_at_us,
    });
}

fn applyDelete(
    conn: *pg.Conn,
    allocator: std.mem.Allocator,
    delete: profile_change.Delete,
) ProfileStore.Error!ApplyResult {
    const commit_cid = delete.proof.commit_cid.toString(allocator) catch
        return error.OutOfMemory;
    defer allocator.free(commit_cid);
    return applyRecord(conn, .{
        .record_uri = delete.record_uri,
        .record_cid = null,
        .owner_did = delete.owner_did,
        .collection = delete.collection,
        .rkey = delete.rkey,
        .avatar = null,
        .bio = null,
        .record_created_at = null,
        .record_updated_at = null,
        .deleted = true,
        .commit_cid = commit_cid,
        .commit_rev = delete.proof.commit_rev,
        .indexed_at_us = delete.proof.indexed_at_us,
    });
}

const RecordWrite = struct {
    record_uri: []const u8,
    record_cid: ?[]const u8,
    owner_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
    avatar: ?[]const u8,
    bio: ?[]const u8,
    record_created_at: ?[]const u8,
    record_updated_at: ?[]const u8,
    deleted: bool,
    commit_cid: []const u8,
    commit_rev: []const u8,
    indexed_at_us: i64,
};

fn applyRecord(conn: *pg.Conn, write: RecordWrite) ProfileStore.Error!ApplyResult {
    const affected = conn.exec(upsert_sql, .{
        write.record_uri,
        write.record_cid,
        write.owner_did,
        write.collection,
        write.rkey,
        write.avatar,
        write.bio,
        write.record_created_at,
        write.record_updated_at,
        write.deleted,
        write.commit_cid,
        write.commit_rev,
        write.indexed_at_us,
    }) catch |err| {
        std.log.err("profile projection upsert failed: {}", .{err});
        return error.ProjectionUnavailable;
    };
    if (affected == 1) return .applied;
    if (affected != 0) return error.CorruptProjection;
    return classifyReplay(conn, write);
}

fn classifyReplay(conn: *pg.Conn, write: RecordWrite) ProfileStore.Error!ApplyResult {
    var current = conn.row(classify_sql, .{write.record_uri}) catch |err| {
        std.log.err("profile projection replay classification failed: {}", .{err});
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

const upsert_sql =
    \\INSERT INTO plyr_index.profile_records (
    \\  record_uri, record_cid, owner_did, collection, rkey, avatar, bio,
    \\  record_created_at, record_updated_at, deleted, commit_cid, commit_rev,
    \\  indexed_at_us
    \\) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  record_cid = EXCLUDED.record_cid,
    \\  owner_did = EXCLUDED.owner_did,
    \\  collection = EXCLUDED.collection,
    \\  rkey = EXCLUDED.rkey,
    \\  avatar = EXCLUDED.avatar,
    \\  bio = EXCLUDED.bio,
    \\  record_created_at = EXCLUDED.record_created_at,
    \\  record_updated_at = EXCLUDED.record_updated_at,
    \\  deleted = EXCLUDED.deleted,
    \\  commit_cid = EXCLUDED.commit_cid,
    \\  commit_rev = EXCLUDED.commit_rev,
    \\  indexed_at_us = EXCLUDED.indexed_at_us
    \\WHERE plyr_index.profile_records.commit_rev < EXCLUDED.commit_rev
;

const classify_sql =
    \\SELECT commit_rev, commit_cid, deleted, record_cid
    \\FROM plyr_index.profile_records WHERE record_uri = $1
;

pub fn createTestTable(pool: *pg.Pool) !void {
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.profile_records (
        \\  record_uri text PRIMARY KEY,
        \\  record_cid text,
        \\  owner_did text NOT NULL,
        \\  collection text NOT NULL,
        \\  rkey text NOT NULL,
        \\  avatar text,
        \\  bio text,
        \\  record_created_at text,
        \\  record_updated_at text,
        \\  deleted boolean NOT NULL,
        \\  commit_cid text NOT NULL,
        \\  commit_rev text NOT NULL,
        \\  indexed_at_us bigint NOT NULL CHECK (indexed_at_us >= 0),
        \\  CHECK (record_uri = 'at://' || owner_did || '/' || collection || '/self'),
        \\  CHECK (rkey = 'self'),
        \\  CHECK ((deleted AND record_cid IS NULL AND avatar IS NULL AND bio IS NULL
        \\    AND record_created_at IS NULL AND record_updated_at IS NULL)
        \\    OR (NOT deleted AND record_cid IS NOT NULL AND record_created_at IS NOT NULL)),
        \\  UNIQUE (owner_did, collection, rkey)
        \\)
    , .{});
}

test "PostgreSQL profile projection replaces records and keeps tombstones" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
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
    var implementation: PostgresProfileStore = .{ .pool = pool };
    const commit_1 = try zat.Cid.forDagCbor(a, "commit-1");
    const commit_2 = try zat.Cid.forDagCbor(a, "commit-2");
    const rev_1 = zat.Tid.fromTimestamp(1_000, 1);
    const rev_2 = zat.Tid.fromTimestamp(2_000, 1);
    const upsert = profileUpsert("one", rev_1.str(), commit_1, 1_000);
    try std.testing.expectEqual(ApplyResult.applied, try implementation.store().apply(a, upsert));
    try std.testing.expectEqual(ApplyResult.idempotent, try implementation.store().apply(a, upsert));
    try expectProfile(pool, "one", rev_1.str(), false);
    const newer = profileUpsert("two", rev_2.str(), commit_2, 2_000);
    try std.testing.expectEqual(ApplyResult.applied, try implementation.store().apply(a, newer));
    try std.testing.expectEqual(ApplyResult.stale, try implementation.store().apply(a, upsert));
    try expectProfile(pool, "two", rev_2.str(), false);
    const deletion: profile_change.Change = .{ .delete = .{
        .record_uri = "at://did:plc:artist/fm.plyr.dev.actor.profile/self",
        .owner_did = "did:plc:artist",
        .collection = "fm.plyr.dev.actor.profile",
        .rkey = "self",
        .proof = .{ .commit_cid = commit_2, .commit_rev = zat.Tid.fromTimestamp(3_000, 1).str(), .indexed_at_us = 3_000 },
    } };
    try std.testing.expectEqual(ApplyResult.applied, try implementation.store().apply(a, deletion));
    try expectProfile(pool, null, zat.Tid.fromTimestamp(3_000, 1).str(), true);
}

pub fn profileUpsert(
    bio: []const u8,
    rev: []const u8,
    commit: zat.Cid,
    indexed_at_us: i64,
) profile_change.Change {
    return .{ .upsert = .{
        .record_uri = "at://did:plc:artist/fm.plyr.dev.actor.profile/self",
        .record_cid = "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        .owner_did = "did:plc:artist",
        .collection = "fm.plyr.dev.actor.profile",
        .rkey = "self",
        .avatar = "https://media.example/avatar.png",
        .bio = bio,
        .created_at = "2026-08-08T12:00:00Z",
        .updated_at = null,
        .proof = .{ .commit_cid = commit, .commit_rev = rev, .indexed_at_us = indexed_at_us },
    } };
}

fn requireDisposableDatabase(pool: *pg.Pool, allocator: std.mem.Allocator) !void {
    var row = (try pool.row("SELECT current_database()", .{})).?;
    const name = try allocator.dupe(u8, try row.get([]const u8, 0));
    defer allocator.free(name);
    try row.deinit();
    if (!std.mem.eql(u8, name, "relay_test")) return error.UnsafeTestDatabase;
}

fn expectProfile(pool: *pg.Pool, bio: ?[]const u8, rev: []const u8, deleted: bool) !void {
    var row = (try pool.row(
        "SELECT bio, commit_rev, deleted FROM plyr_index.profile_records WHERE rkey = 'self'",
        .{},
    )).?;
    defer row.deinit() catch {};
    try std.testing.expect(optionalEql(try row.get(?[]const u8, 0), bio));
    try std.testing.expectEqualStrings(rev, try row.get([]const u8, 1));
    try std.testing.expectEqual(deleted, try row.get(bool, 2));
}
