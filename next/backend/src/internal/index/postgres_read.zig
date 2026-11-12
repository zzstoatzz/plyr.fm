const std = @import("std");
const pg = @import("pg");

pub const Error = error{ IndexUnavailable, CorruptProjection, OutOfMemory, ReadConnectionLost };

pub fn run(comptime Result: type, operation: anytype, arguments: anytype) Result {
    return @call(.auto, operation, arguments) catch |err| {
        if (err != error.ReadConnectionLost) return @errorCast(err);
        return @call(.auto, operation, arguments) catch |retry_error| switch (retry_error) {
            error.ReadConnectionLost => error.IndexUnavailable,
            else => @errorCast(retry_error),
        };
    };
}

pub fn failure(conn: *pg.Conn, err: anyerror) Error {
    const code = if (conn.err) |value| value.code else null;
    if (connectionLost(err, code)) {
        conn._state = .fail;
        return error.ReadConnectionLost;
    }
    return if (err == error.OutOfMemory) error.OutOfMemory else error.IndexUnavailable;
}

fn connectionLost(err: anyerror, code: ?[]const u8) bool {
    return switch (err) {
        error.Closed, error.ConnectionResetByPeer, error.ConnectionAborted, error.BrokenPipe, error.SocketNotConnected, error.SSLReadFailed, error.SSLWriteFailed => true,
        error.PG => if (code) |value|
            std.mem.eql(u8, value, "08003") or std.mem.eql(u8, value, "08006") or
                std.mem.eql(u8, value, "57P01") or std.mem.eql(u8, value, "57P02")
        else
            false,
        else => false,
    };
}

test "read retry only repeats a lost connection and stops after two attempts" {
    const Read = struct {
        calls: usize = 0,
        fail_count: usize,
        failure: Error,

        fn execute(self: *@This()) Error!usize {
            self.calls += 1;
            if (self.calls <= self.fail_count) return self.failure;
            return self.calls;
        }
    };
    const Result = error{ IndexUnavailable, CorruptProjection, OutOfMemory }!usize;
    var recovered: Read = .{ .fail_count = 1, .failure = error.ReadConnectionLost };
    try std.testing.expectEqual(@as(usize, 2), try run(Result, Read.execute, .{&recovered}));
    var unavailable: Read = .{ .fail_count = 3, .failure = error.ReadConnectionLost };
    try std.testing.expectError(error.IndexUnavailable, run(Result, Read.execute, .{&unavailable}));
    try std.testing.expectEqual(@as(usize, 2), unavailable.calls);
    inline for (.{ error.IndexUnavailable, error.CorruptProjection, error.OutOfMemory }) |err| {
        var failed: Read = .{ .fail_count = 3, .failure = err };
        try std.testing.expectError(err, run(Result, Read.execute, .{&failed}));
        try std.testing.expectEqual(@as(usize, 1), failed.calls);
    }
}

test "read retry excludes SQL errors timeouts and local failures" {
    for ([_][]const u8{ "08003", "08006", "57P01", "57P02" }) |code|
        try std.testing.expect(connectionLost(error.PG, code));
    for ([_][]const u8{ "42601", "23505", "57014", "40001", "08P01" }) |code|
        try std.testing.expect(!connectionLost(error.PG, code));
    inline for (.{ error.Timeout, error.ConnectionTimedOut, error.OutOfMemory, error.PoolExhausted, error.UnexpectedDBMessage }) |err|
        try std.testing.expect(!connectionLost(err, "08006"));
    try std.testing.expect(!connectionLost(error.PG, null));
    try std.testing.expect(connectionLost(error.Closed, null));
}

test "read retry discards partial rows and replaces the terminated connection" {
    const url = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    const uri = try std.Uri.parse(std.mem.span(url));
    var admin = try pg.Conn.openAndAuthUri(io, allocator, uri);
    defer admin.deinit();
    var database = (try admin.row("SELECT current_database()", .{})).?;
    const safe = std.mem.eql(u8, try database.get([]const u8, 0), "zig_test");
    try database.deinit();
    if (!safe) return error.UnsafeTestDatabase;
    const pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    const Read = struct {
        pool: *pg.Pool,
        admin: *pg.Conn,
        allocator: std.mem.Allocator,
        attempts: usize = 0,
        first_pid: i32 = 0,
        second_pid: i32 = 0,
        interrupted: bool = false,

        fn execute(self: *@This()) Error![]i32 {
            self.attempts += 1;
            const conn = self.pool.acquire() catch return error.IndexUnavailable;
            defer self.pool.release(conn);
            var rows = conn.queryOpts(
                "SELECT pg_backend_pid(), i, repeat('x', 4096), pg_sleep(CASE WHEN $1::bool THEN 0.001 ELSE 0 END) FROM generate_series(1, 1000) i",
                .{self.attempts == 1},
                .{ .cache_name = "read_recovery_stream_test" },
            ) catch |err| return failure(conn, err);
            defer rows.deinit();
            var values: std.ArrayList(i32) = .empty;
            errdefer values.deinit(self.allocator);
            while (rows.next() catch |err| return failure(conn, err)) |row| {
                const pid = row.get(i32, 0) catch return error.CorruptProjection;
                try values.append(self.allocator, row.get(i32, 1) catch return error.CorruptProjection);
                if (self.attempts == 1 and !self.interrupted) {
                    self.first_pid = pid;
                    var killed = (self.admin.row("SELECT pg_terminate_backend($1)", .{pid}) catch
                        return error.IndexUnavailable) orelse return error.IndexUnavailable;
                    self.interrupted = killed.get(bool, 0) catch return error.CorruptProjection;
                    killed.deinit() catch return error.IndexUnavailable;
                } else if (self.attempts == 2) self.second_pid = pid;
            }
            return values.toOwnedSlice(self.allocator);
        }
    };
    var reader: Read = .{ .pool = pool, .admin = &admin, .allocator = allocator };
    const Result = error{ IndexUnavailable, CorruptProjection, OutOfMemory }![]i32;
    const values = try run(Result, Read.execute, .{&reader});
    defer allocator.free(values);
    try std.testing.expect(reader.interrupted);
    try std.testing.expectEqual(@as(usize, 2), reader.attempts);
    try std.testing.expect(reader.first_pid != reader.second_pid);
    try std.testing.expectEqual(@as(usize, 1000), values.len);
    for (values, 1..) |value, expected| try std.testing.expectEqual(@as(i32, @intCast(expected)), value);
}
