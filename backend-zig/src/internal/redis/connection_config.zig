//! Owned Redis connection configuration shared by infrastructure adapters.
//!
//! Domain ports never see Redis URLs. This module is the single place that
//! interprets deployment credentials, database selection, and socket timeout
//! policy for the small adapters that each own a serialized connection.

const std = @import("std");
const redis = @import("redis");

pub const ConnectionConfig = struct {
    arena: std.heap.ArenaAllocator,
    host: []const u8,
    port: u16,
    username: []const u8,
    password: []const u8,
    db: u8,

    pub fn parse(allocator: std.mem.Allocator, url: []const u8) !ConnectionConfig {
        const uri = std.Uri.parse(url) catch return error.InvalidRedisUrl;
        if (!std.mem.eql(u8, uri.scheme, "redis")) return error.UnsupportedRedisScheme;
        if (uri.query != null or uri.fragment != null) return error.InvalidRedisUrl;

        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const a = arena.allocator();
        const host = try (uri.host orelse return error.InvalidRedisUrl).toRawMaybeAlloc(a);
        if (host.len == 0) return error.InvalidRedisUrl;
        const username = if (uri.user) |value| try value.toRawMaybeAlloc(a) else "default";
        const password = if (uri.password) |value| try value.toRawMaybeAlloc(a) else "";
        const raw_path = try uri.path.toRawMaybeAlloc(a);
        const database = std.mem.trim(u8, raw_path, "/");
        if (std.mem.indexOfScalar(u8, database, '/') != null)
            return error.InvalidRedisUrl;
        const db = if (database.len == 0)
            0
        else
            std.fmt.parseInt(u8, database, 10) catch return error.InvalidRedisDatabase;
        return .{
            .arena = arena,
            .host = host,
            .port = uri.port orelse 6379,
            .username = if (username.len == 0) "default" else username,
            .password = password,
            .db = db,
        };
    }

    pub fn deinit(self: *ConnectionConfig) void {
        self.arena.deinit();
        self.* = undefined;
    }

    pub fn connect(
        self: ConnectionConfig,
        io: std.Io,
        allocator: std.mem.Allocator,
    ) !redis.Client {
        return redis.Client.connectWithConfig(io, allocator, .{
            .host = self.host,
            .port = self.port,
            .username = self.username,
            .password = self.password,
            .db = self.db,
            .read_timeout_ms = 250,
            .write_timeout_ms = 250,
        });
    }
};

test "deployment Redis URLs preserve credentials and database" {
    var parsed = try ConnectionConfig.parse(
        std.testing.allocator,
        "redis://worker:p%40ss@redis.internal:6380/7",
    );
    defer parsed.deinit();
    try std.testing.expectEqualStrings("redis.internal", parsed.host);
    try std.testing.expectEqualStrings("worker", parsed.username);
    try std.testing.expectEqualStrings("p@ss", parsed.password);
    try std.testing.expectEqual(@as(u16, 6380), parsed.port);
    try std.testing.expectEqual(@as(u8, 7), parsed.db);
}

test "ambiguous or unsupported Redis URLs fail configuration" {
    try std.testing.expectError(
        error.UnsupportedRedisScheme,
        ConnectionConfig.parse(std.testing.allocator, "rediss://redis.internal/0"),
    );
    try std.testing.expectError(
        error.InvalidRedisUrl,
        ConnectionConfig.parse(std.testing.allocator, "redis://redis.internal/0?tls=true"),
    );
    try std.testing.expectError(
        error.InvalidRedisDatabase,
        ConnectionConfig.parse(std.testing.allocator, "redis://redis.internal/not-a-db"),
    );
}
