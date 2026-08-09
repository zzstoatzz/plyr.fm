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

pub const RedisPlayDedupStore = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    config_arena: std.heap.ArenaAllocator,
    host: []const u8,
    port: u16,
    username: []const u8,
    password: []const u8,
    db: u8,
    client: ?redis.Client = null,
    mutex: std.Io.Mutex = std.Io.Mutex.init,

    pub fn init(
        allocator: std.mem.Allocator,
        io: std.Io,
        url: []const u8,
    ) !RedisPlayDedupStore {
        const parsed = try parseUrl(allocator, url);
        return .{
            .allocator = allocator,
            .io = io,
            .config_arena = parsed.arena,
            .host = parsed.host,
            .port = parsed.port,
            .username = parsed.username,
            .password = parsed.password,
            .db = parsed.db,
        };
    }

    pub fn deinit(self: *RedisPlayDedupStore) void {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        if (self.client) |*client| client.close();
        self.client = null;
        self.config_arena.deinit();
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
        return redis.Client.connectWithConfig(self.io, self.allocator, .{
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

const ParsedUrl = struct {
    arena: std.heap.ArenaAllocator,
    host: []const u8,
    port: u16,
    username: []const u8,
    password: []const u8,
    db: u8,

    fn deinit(self: *ParsedUrl) void {
        self.arena.deinit();
    }
};

fn parseUrl(allocator: std.mem.Allocator, url: []const u8) !ParsedUrl {
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
    if (std.mem.indexOfScalar(u8, database, '/') != null) return error.InvalidRedisUrl;
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

test "deployment Redis URLs preserve credentials and database" {
    var parsed = try parseUrl(
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
        parseUrl(std.testing.allocator, "rediss://redis.internal/0"),
    );
    try std.testing.expectError(
        error.InvalidRedisUrl,
        parseUrl(std.testing.allocator, "redis://redis.internal/0?tls=true"),
    );
    try std.testing.expectError(
        error.InvalidRedisDatabase,
        parseUrl(std.testing.allocator, "redis://redis.internal/not-a-db"),
    );
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
