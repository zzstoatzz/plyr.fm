//! PostgreSQL adapter for sync.Store: plyr's copy of space records and the
//! stream cursor per space, moved together in one transaction.

const std = @import("std");
const pg = @import("pg");
const postgres_test_lock = @import("../testing/postgres_lock.zig");
const sync = @import("sync.zig");

pub const PostgresSyncStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresSyncStore) sync.Store {
        return .{ .context = self, .cursor_fn = cursorFn, .apply_fn = applyFn, .drop_repo_fn = dropRepoFn, .drop_space_fn = dropSpaceFn, .advance_fn = advanceFn };
    }

    fn of(context: *anyopaque) *PostgresSyncStore {
        return @ptrCast(@alignCast(context));
    }

    fn cursorFn(context: *anyopaque, space: []const u8) anyerror!?u64 {
        var row = (try of(context).pool.row("SELECT time_us FROM plyr_index.space_cursors WHERE space = $1", .{space})) orelse return null;
        defer row.deinit() catch {};
        return std.math.cast(u64, try row.get(i64, 0)) orelse error.CorruptCursor;
    }

    fn applyFn(context: *anyopaque, space: []const u8, at: u64, repo: []const u8, rev: []const u8, op: sync.Op) anyerror!void {
        var tx = try Transaction.open(of(context).pool);
        defer tx.close();
        switch (op) {
            .put => |put| _ = try tx.conn.exec(put_sql, .{ space, repo, put.collection, put.rkey, rev, put.cid, put.value_json }),
            .delete => |delete| _ = try tx.conn.exec(delete_sql, .{ space, repo, delete.collection, delete.rkey }),
        }
        try tx.commit(space, at);
    }

    fn dropRepoFn(context: *anyopaque, space: []const u8, at: u64, repo: []const u8) anyerror!void {
        var tx = try Transaction.open(of(context).pool);
        defer tx.close();
        _ = try tx.conn.exec("DELETE FROM plyr_index.space_records WHERE space = $1 AND repo_did = $2", .{ space, repo });
        try tx.commit(space, at);
    }

    fn dropSpaceFn(context: *anyopaque, space: []const u8) anyerror!void {
        var tx = try Transaction.open(of(context).pool);
        defer tx.close();
        _ = try tx.conn.exec("DELETE FROM plyr_index.space_records WHERE space = $1", .{space});
        _ = try tx.conn.exec("DELETE FROM plyr_index.space_cursors WHERE space = $1", .{space});
        try tx.conn.commit();
        tx.pending = false;
    }

    fn advanceFn(context: *anyopaque, space: []const u8, at: u64) anyerror!void {
        _ = try of(context).pool.exec(cursor_sql, .{ space, try signed(at) });
    }
};

const Transaction = struct {
    conn: *pg.Conn,
    pending: bool,

    fn open(pool: *pg.Pool) !Transaction {
        const conn = try pool.acquire();
        errdefer conn.release();
        try conn.begin();
        return .{ .conn = conn, .pending = true };
    }

    fn commit(self: *Transaction, space: []const u8, at: u64) !void {
        _ = try self.conn.exec(cursor_sql, .{ space, try signed(at) });
        try self.conn.commit();
        self.pending = false;
    }

    fn close(self: *Transaction) void {
        if (self.pending) self.conn.rollback() catch |err| std.log.err("space copy rollback failed: {}", .{err});
        self.conn.release();
    }
};

fn signed(at: u64) !i64 {
    return std.math.cast(i64, at) orelse error.CursorOutOfRange;
}

const put_sql =
    \\INSERT INTO plyr_index.space_records (space, repo_did, collection, rkey, rev, cid, value)
    \\VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    \\ON CONFLICT (space, repo_did, collection, rkey) DO UPDATE SET
    \\  rev = EXCLUDED.rev, cid = EXCLUDED.cid, value = EXCLUDED.value
;

const delete_sql =
    \\DELETE FROM plyr_index.space_records
    \\WHERE space = $1 AND repo_did = $2 AND collection = $3 AND rkey = $4
;

const cursor_sql =
    \\INSERT INTO plyr_index.space_cursors (space, time_us) VALUES ($1, $2)
    \\ON CONFLICT (space) DO UPDATE SET time_us = EXCLUDED.time_us, updated_at = clock_timestamp()
    \\WHERE plyr_index.space_cursors.time_us < EXCLUDED.time_us
;

test "space copies and cursors move together and drop by repo or space" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    var pool = try pg.Pool.initUri(io, allocator, try std.Uri.parse(std.mem.span(url_z)), .{ .size = 1 });
    defer pool.deinit();
    try requireDisposableDatabase(pool);
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec(@embedFile("migration_0040_space_copies"), .{});

    var adapter: PostgresSyncStore = .{ .pool = pool };
    const port = adapter.store();
    const space = "at://did:plc:artist/space/fm.plyr.next.audio/3album";
    try std.testing.expectEqual(@as(?u64, null), try port.cursor(space));
    try port.apply(space, 10, "did:plc:artist", "r1", .{ .put = .{ .collection = "fm.plyr.track", .rkey = "3song", .cid = "bafy1", .value_json = "{\"title\":\"song\"}" } });
    try port.apply(space, 11, "did:plc:artist", "r2", .{ .put = .{ .collection = "fm.plyr.track", .rkey = "3song", .cid = "bafy2", .value_json = "{\"title\":\"song 2\"}" } });
    try port.apply(space, 12, "did:plc:fan", "r1", .{ .put = .{ .collection = "fm.plyr.track", .rkey = "3x", .cid = "bafy3", .value_json = "{}" } });
    try std.testing.expectEqual(@as(?u64, 12), try port.cursor(space));
    try std.testing.expectEqual(@as(i64, 2), try count(pool, space));
    {
        var row = (try pool.row("SELECT cid, value->>'title' FROM plyr_index.space_records WHERE rkey = '3song'", .{})).?;
        defer row.deinit() catch {};
        try std.testing.expectEqualStrings("bafy2", try row.get([]const u8, 0));
        try std.testing.expectEqualStrings("song 2", try row.get([]const u8, 1));
    }
    // a cursor never moves back
    try port.advance(space, 5);
    try std.testing.expectEqual(@as(?u64, 12), try port.cursor(space));
    try port.dropRepo(space, 13, "did:plc:fan");
    try std.testing.expectEqual(@as(i64, 1), try count(pool, space));
    try port.apply(space, 14, "did:plc:artist", "r3", .{ .delete = .{ .collection = "fm.plyr.track", .rkey = "3song" } });
    try std.testing.expectEqual(@as(i64, 0), try count(pool, space));
    try port.apply(space, 15, "did:plc:artist", "r4", .{ .put = .{ .collection = "fm.plyr.track", .rkey = "3new", .cid = "bafy4", .value_json = "{}" } });
    try port.dropSpace(space);
    try std.testing.expectEqual(@as(i64, 0), try count(pool, space));
    try std.testing.expectEqual(@as(?u64, null), try port.cursor(space));
}

fn count(pool: *pg.Pool, space: []const u8) !i64 {
    var row = (try pool.row("SELECT count(*) FROM plyr_index.space_records WHERE space = $1", .{space})).?;
    defer row.deinit() catch {};
    return row.get(i64, 0);
}

fn requireDisposableDatabase(pool: *pg.Pool) !void {
    var row = try pool.row("SELECT current_database()", .{}) orelse return error.MissingDatabase;
    defer row.deinit() catch {};
    if (!std.mem.eql(u8, try row.get([]const u8, 0), "zig_test")) return error.UnsafeTestDatabase;
}
