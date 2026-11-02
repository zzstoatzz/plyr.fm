//! Redis `SET NX EX` admission for play-count deduplication.
//!
//! One shared connection is serialized with an I/O-aware mutex. Play reports
//! arrive only after sustained listening, so this avoids an idle connection
//! pool while keeping connection setup off the steady-state request path. A
//! broken socket is discarded; the next claim reconnects and the application
//! counts the current play fail-open.

const std = @import("std");
const redis = @import("redis");
const PlayDedupStore = @import("play_dedup_store.zig").PlayDedupStore;
const ConnectionConfig = @import("../redis/connection_config.zig").ConnectionConfig;

pub const RedisPlayDedupStore = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    connection: ConnectionConfig,
    client: ?redis.Client = null,
    mutex: std.Io.Mutex = std.Io.Mutex.init,

    pub fn init(
        allocator: std.mem.Allocator,
        io: std.Io,
        url: []const u8,
    ) !RedisPlayDedupStore {
        const connection = try ConnectionConfig.parse(allocator, url);
        return .{
            .allocator = allocator,
            .io = io,
            .connection = connection,
        };
    }

    pub fn deinit(self: *RedisPlayDedupStore) void {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        if (self.client) |*client| client.close();
        self.client = null;
        self.connection.deinit();
    }

    pub fn store(self: *RedisPlayDedupStore) PlayDedupStore {
        return .{ .context = self, .claim_fn = claimOpaque };
    }

    fn claimOpaque(
        context: *anyopaque,
        listener_key: []const u8,
        record_uri: []const u8,
        ttl_seconds: u32,
    ) PlayDedupStore.Error!bool {
        const self: *RedisPlayDedupStore = @ptrCast(@alignCast(context));
        return self.claim(listener_key, record_uri, ttl_seconds);
    }

    fn claim(
        self: *RedisPlayDedupStore,
        listener_key: []const u8,
        record_uri: []const u8,
        ttl_seconds: u32,
    ) PlayDedupStore.Error!bool {
        if (listener_key.len == 0 or record_uri.len == 0 or ttl_seconds == 0)
            return error.DedupUnavailable;
        var key_buffer: [96]u8 = undefined;
        const key = dedupKey(&key_buffer, listener_key, record_uri) catch
            return error.DedupUnavailable;
        var ttl_buffer: [10]u8 = undefined;
        const ttl = std.fmt.bufPrint(&ttl_buffer, "{d}", .{ttl_seconds}) catch
            return error.DedupUnavailable;

        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        if (self.client == null) self.client = self.connect() catch
            return error.DedupUnavailable;
        const result = self.client.?.sendCommand(&.{ "SET", key, "1", "NX", "EX", ttl }) catch {
            self.client.?.close();
            self.client = null;
            return error.DedupUnavailable;
        };
        return switch (result) {
            .string => true,
            .nil => false,
            else => {
                self.client.?.close();
                self.client = null;
                return error.DedupUnavailable;
            },
        };
    }

    fn connect(self: *RedisPlayDedupStore) !redis.Client {
        return self.connection.connect(self.io, self.allocator);
    }
};

fn dedupKey(
    destination: *[96]u8,
    listener_key: []const u8,
    record_uri: []const u8,
) ![]const u8 {
    var digest: [std.crypto.hash.sha2.Sha256.digest_length]u8 = undefined;
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    hasher.update(listener_key);
    hasher.update(&.{0});
    hasher.update(record_uri);
    hasher.final(&digest);
    return std.fmt.bufPrint(destination, "plyr:play-count:v1:{x}", .{digest});
}

test "dedup keys are bounded and domain separated" {
    var first_buffer: [96]u8 = undefined;
    var second_buffer: [96]u8 = undefined;
    const first = try dedupKey(&first_buffer, "anon:a", "at://did:plc:a/fm.plyr.track/x");
    const second = try dedupKey(&second_buffer, "anon:a", "at://did:plc:a/fm.plyr.track/y");
    try std.testing.expect(std.mem.startsWith(u8, first, "plyr:play-count:v1:"));
    try std.testing.expectEqual(@as(usize, 83), first.len);
    try std.testing.expect(!std.mem.eql(u8, first, second));
    try std.testing.expect(std.mem.indexOf(u8, first, "anon:a") == null);
}

test "Redis atomically admits one play per listener and record window" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_REDIS_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    var implementation = try RedisPlayDedupStore.init(
        allocator,
        io,
        std.mem.span(url_z),
    );
    defer implementation.deinit();

    var nonce: [16]u8 = undefined;
    io.random(&nonce);
    const listener = try std.fmt.allocPrint(allocator, "integration:{x}", .{nonce});
    defer allocator.free(listener);
    const record_uri = "at://did:plc:test/fm.plyr.dev.track/redis-integration";

    try std.testing.expect(try implementation.claim(listener, record_uri, 30));
    try std.testing.expect(!try implementation.claim(listener, record_uri, 30));
}
