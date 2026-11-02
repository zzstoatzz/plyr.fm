//! Redis-backed fixed-window admission for OAuth starts.
//!
//! A Lua command makes increment plus first-use expiry indivisible. The
//! adapter owns one serialized, lazy connection. A failed command discards the
//! socket so the next request can recover; this path fails closed because an
//! admitted request performs several attacker-triggerable network operations.

const std = @import("std");
const redis = @import("redis");
const admission = @import("start_admission.zig");
const ConnectionConfig = @import("../redis/connection_config.zig").ConnectionConfig;

const script =
    \\local function hit(key, window)
    \\  local current = redis.call('INCR', key)
    \\  if current == 1 then redis.call('EXPIRE', key, window) end
    \\  return current, redis.call('TTL', key)
    \\end
    \\local client_count, client_ttl = hit(KEYS[1], ARGV[1])
    \\local subject_count, subject_ttl = hit(KEYS[2], ARGV[1])
    \\local global_count, global_ttl = hit(KEYS[3], ARGV[1])
    \\return {client_count, client_ttl, subject_count, subject_ttl, global_count, global_ttl}
;

pub const RedisStartAdmission = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    connection: ConnectionConfig,
    client: ?redis.Client = null,
    mutex: std.Io.Mutex = std.Io.Mutex.init,

    pub fn init(
        allocator: std.mem.Allocator,
        io: std.Io,
        url: []const u8,
    ) !RedisStartAdmission {
        const connection = try ConnectionConfig.parse(allocator, url);
        var self: RedisStartAdmission = .{
            .allocator = allocator,
            .io = io,
            .connection = connection,
        };
        errdefer self.connection.deinit();
        self.client = try self.connect();
        errdefer if (self.client) |*client| client.close();
        const pong = try self.client.?.sendCommand(&.{"PING"});
        if (pong.asString() == null or !std.mem.eql(u8, pong.asString().?, "PONG"))
            return error.InvalidRedisResponse;
        return self;
    }

    pub fn deinit(self: *RedisStartAdmission) void {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        if (self.client) |*client| client.close();
        self.client = null;
        self.connection.deinit();
    }

    pub fn store(self: *RedisStartAdmission) admission.Store {
        return .{ .context = self, .admit_fn = admitOpaque };
    }

    fn admitOpaque(
        context: *anyopaque,
        client_key: []const u8,
        subject_key: []const u8,
        policy: admission.Policy,
    ) admission.Store.Error!admission.Decision {
        const self: *RedisStartAdmission = @ptrCast(@alignCast(context));
        return self.admit(client_key, subject_key, policy);
    }

    fn admit(
        self: *RedisStartAdmission,
        client_key: []const u8,
        subject_key: []const u8,
        policy: admission.Policy,
    ) admission.Store.Error!admission.Decision {
        var client_buffer: [96]u8 = undefined;
        const client = admissionKey(&client_buffer, "client", client_key) catch
            return error.AdmissionUnavailable;
        var subject_buffer: [96]u8 = undefined;
        const subject = admissionKey(&subject_buffer, "subject", subject_key) catch
            return error.AdmissionUnavailable;
        var window_buffer: [10]u8 = undefined;
        const window = std.fmt.bufPrint(&window_buffer, "{d}", .{policy.window_seconds}) catch
            return error.AdmissionUnavailable;

        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        if (self.client == null) self.client = self.connect() catch
            return error.AdmissionUnavailable;
        const value = self.client.?.sendCommand(&.{
            "EVAL", script, "3", client, subject, "plyr:auth-start:v1:global", window,
        }) catch {
            self.discardClient();
            return error.AdmissionUnavailable;
        };
        const values = value.asArray() orelse {
            self.discardClient();
            return error.AdmissionUnavailable;
        };
        if (values.len != 6) {
            self.discardClient();
            return error.AdmissionUnavailable;
        }
        var counts: [3]i64 = undefined;
        var ttls: [3]i64 = undefined;
        for (0..3) |index| {
            counts[index] = values[index * 2].asInt() orelse {
                self.discardClient();
                return error.AdmissionUnavailable;
            };
            ttls[index] = values[index * 2 + 1].asInt() orelse {
                self.discardClient();
                return error.AdmissionUnavailable;
            };
            if (counts[index] < 1 or ttls[index] < 1 or ttls[index] > std.math.maxInt(u32)) {
                self.discardClient();
                return error.AdmissionUnavailable;
            }
        }
        return decide(counts, ttls, policy);
    }

    fn connect(self: *RedisStartAdmission) !redis.Client {
        return self.connection.connect(self.io, self.allocator);
    }

    fn discardClient(self: *RedisStartAdmission) void {
        if (self.client) |*client| client.close();
        self.client = null;
    }
};

fn admissionKey(
    destination: *[96]u8,
    kind: []const u8,
    value: []const u8,
) ![]const u8 {
    var digest: [std.crypto.hash.sha2.Sha256.digest_length]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(value, &digest, .{});
    return std.fmt.bufPrint(destination, "plyr:auth-start:v1:{s}:{x}", .{ kind, digest });
}

fn decide(
    counts: [3]i64,
    ttls: [3]i64,
    policy: admission.Policy,
) admission.Decision {
    const limits = [_]u32{ policy.client_limit, policy.subject_limit, policy.global_limit };
    var retry_after: u32 = 0;
    for (counts, ttls, limits) |count, ttl, limit| {
        if (count > limit) retry_after = @max(retry_after, @as(u32, @intCast(ttl)));
    }
    return if (retry_after == 0) .allowed else .{ .denied = retry_after };
}

test "admission keys are bounded, private, and purpose separated" {
    var first_buffer: [96]u8 = undefined;
    var second_buffer: [96]u8 = undefined;
    const first = try admissionKey(&first_buffer, "client", "203.0.113.4");
    const second = try admissionKey(&second_buffer, "subject", "203.0.113.4");
    try std.testing.expect(std.mem.startsWith(u8, first, "plyr:auth-start:v1:client:"));
    try std.testing.expectEqual(@as(usize, 90), first.len);
    try std.testing.expect(!std.mem.eql(u8, first, second));
    try std.testing.expect(std.mem.indexOf(u8, first, "203.0.113.4") == null);
}

test "client, subject, and global limits each close admission" {
    const policy: admission.Policy = .{
        .client_limit = 10,
        .subject_limit = 10,
        .global_limit = 120,
        .window_seconds = 60,
    };
    try std.testing.expect(decide(.{ 10, 10, 120 }, .{ 5, 6, 7 }, policy) == .allowed);
    try std.testing.expectEqual(@as(u32, 5), decide(.{ 11, 1, 1 }, .{ 5, 6, 7 }, policy).denied);
    try std.testing.expectEqual(@as(u32, 6), decide(.{ 1, 11, 1 }, .{ 5, 6, 7 }, policy).denied);
    try std.testing.expectEqual(@as(u32, 7), decide(.{ 1, 1, 121 }, .{ 5, 6, 7 }, policy).denied);
    try std.testing.expectEqual(@as(u32, 7), decide(.{ 11, 11, 121 }, .{ 5, 6, 7 }, policy).denied);
}

test "Redis atomically limits one client within a fixed window" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_REDIS_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    var implementation = try RedisStartAdmission.init(allocator, io, std.mem.span(url_z));
    defer implementation.deinit();
    const store = implementation.store();
    var second_implementation = try RedisStartAdmission.init(allocator, io, std.mem.span(url_z));
    defer second_implementation.deinit();
    const second_store = second_implementation.store();

    var nonce: [16]u8 = undefined;
    io.random(&nonce);
    var client_buffer: [64]u8 = undefined;
    const client_key = try std.fmt.bufPrint(&client_buffer, "test:{x}", .{nonce});
    var subject_buffer: [64]u8 = undefined;
    const subject_key = try std.fmt.bufPrint(&subject_buffer, "artist-{x}.example", .{nonce});
    const policy: admission.Policy = .{
        .client_limit = 2,
        .subject_limit = 2,
        .global_limit = 1000,
        .window_seconds = 60,
    };
    try std.testing.expect((try store.admit(client_key, subject_key, policy)) == .allowed);
    try std.testing.expect((try second_store.admit(client_key, subject_key, policy)) == .allowed);
    const denied = try store.admit(client_key, subject_key, policy);
    try std.testing.expect(denied == .denied);
    try std.testing.expect(denied.denied >= 1 and denied.denied <= 60);
}
