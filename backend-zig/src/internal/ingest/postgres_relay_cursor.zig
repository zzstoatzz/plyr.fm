//! PostgreSQL adapter for the relay checkpoint port.

const std = @import("std");
const pg = @import("pg");
const relay_cursor = @import("relay_cursor.zig");

pub const PostgresRelayCursor = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresRelayCursor) relay_cursor.Store {
        return .{ .context = self, .load_fn = loadOpaque, .save_fn = saveOpaque };
    }

    fn loadOpaque(context: *anyopaque, source: []const u8) relay_cursor.Error!?i64 {
        return (@as(*PostgresRelayCursor, @ptrCast(@alignCast(context)))).load(source);
    }

    fn saveOpaque(
        context: *anyopaque,
        source: []const u8,
        seq: i64,
        now_us: i64,
    ) relay_cursor.Error!void {
        return (@as(*PostgresRelayCursor, @ptrCast(@alignCast(context)))).save(
            source,
            seq,
            now_us,
        );
    }

    fn load(self: *PostgresRelayCursor, source: []const u8) relay_cursor.Error!?i64 {
        var row = self.pool.row(load_sql, .{source}) catch |err| {
            std.log.err("relay cursor read failed: {}", .{err});
            return error.CursorUnavailable;
        } orelse return null;
        defer row.deinit() catch {};
        const seq = row.get(i64, 0) catch return error.CorruptCursor;
        if (seq < 0) return error.CorruptCursor;
        return seq;
    }

    fn save(
        self: *PostgresRelayCursor,
        source: []const u8,
        seq: i64,
        now_us: i64,
    ) relay_cursor.Error!void {
        _ = self.pool.exec(save_sql, .{ source, seq, now_us }) catch |err| {
            std.log.err("relay cursor write failed: {}", .{err});
            return error.CursorUnavailable;
        };
    }
};

const load_sql =
    \\SELECT seq FROM plyr_index.relay_cursors WHERE source = $1
;

const save_sql =
    \\INSERT INTO plyr_index.relay_cursors (source, seq, updated_at_us)
    \\VALUES ($1, $2, $3)
    \\ON CONFLICT (source) DO UPDATE SET
    \\  seq = EXCLUDED.seq,
    \\  updated_at_us = EXCLUDED.updated_at_us
    \\WHERE plyr_index.relay_cursors.seq < EXCLUDED.seq
;

test "PostgreSQL cursor persistence is source-scoped and monotonic" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(threaded.io(), allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    try requireDisposableDatabase(pool);
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.relay_cursors (
        \\  source text PRIMARY KEY,
        \\  seq bigint NOT NULL CHECK (seq >= 0),
        \\  updated_at_us bigint NOT NULL CHECK (updated_at_us >= 0)
        \\)
    , .{});

    var adapter: PostgresRelayCursor = .{ .pool = pool };
    const port = adapter.store();
    try std.testing.expect(try port.load("relay-a") == null);
    try port.save("relay-a", 20, 100);
    try port.save("relay-a", 19, 200);
    try port.save("relay-b", 7, 300);
    try std.testing.expectEqual(@as(?i64, 20), try port.load("relay-a"));
    try std.testing.expectEqual(@as(?i64, 7), try port.load("relay-b"));
}

fn requireDisposableDatabase(pool: *pg.Pool) !void {
    var row = try pool.row("SELECT current_database()", .{}) orelse return error.MissingDatabase;
    defer row.deinit() catch {};
    const name = try row.get([]const u8, 0);
    if (!std.mem.eql(u8, name, "relay_test")) return error.UnsafeTestDatabase;
}
