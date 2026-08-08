//! Bounded signing-key cache with explicit rotation invalidation.

const std = @import("std");
const zat = @import("zat");
const lru = @import("../cache/lru.zig");
const signing_key = @import("signing_key.zig");

const CachedKey = struct {
    key_type: zat.multicodec.KeyType,
    raw: [33]u8 = undefined,
    length: u8,
};

pub const CachedSigningKeyResolver = struct {
    upstream: signing_key.Resolver,
    cache: lru.Lru(CachedKey),

    pub fn init(
        allocator: std.mem.Allocator,
        io: std.Io,
        capacity: usize,
        upstream: signing_key.Resolver,
    ) CachedSigningKeyResolver {
        return .{
            .upstream = upstream,
            .cache = .init(allocator, io, capacity),
        };
    }

    pub fn deinit(self: *CachedSigningKeyResolver) void {
        self.cache.deinit();
    }

    pub fn port(self: *CachedSigningKeyResolver) signing_key.Resolver {
        return .{ .context = self, .resolve_fn = resolveOpaque };
    }

    pub fn evict(self: *CachedSigningKeyResolver, did: []const u8) void {
        _ = self.cache.remove(did);
    }

    fn resolveOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        did: []const u8,
        refresh: bool,
    ) signing_key.Error!signing_key.Key {
        const self: *CachedSigningKeyResolver = @ptrCast(@alignCast(context));
        if (!refresh) if (self.cache.get(did)) |cached| {
            return .{
                .key_type = cached.key_type,
                .raw = allocator.dupe(u8, cached.raw[0..cached.length]) catch
                    return error.OutOfMemory,
            };
        };

        const resolved = try self.upstream.resolve(allocator, did, refresh);
        var cached: CachedKey = .{
            .key_type = resolved.key_type,
            .length = @intCast(resolved.raw.len),
        };
        @memcpy(cached.raw[0..resolved.raw.len], resolved.raw);
        // A cache allocation failure must not discard a successfully resolved
        // public key or turn identity availability into request failure.
        self.cache.put(did, cached) catch {};
        return resolved;
    }
};

test "signing key cache hits, refreshes, evicts, and remains bounded" {
    const Upstream = struct {
        calls: usize = 0,

        fn resolve(
            context: *anyopaque,
            allocator: std.mem.Allocator,
            _: []const u8,
            _: bool,
        ) signing_key.Error!signing_key.Key {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.calls += 1;
            const byte: u8 = @intCast(self.calls);
            const raw = try allocator.alloc(u8, 1);
            raw[0] = byte;
            return .{ .key_type = .p256, .raw = raw };
        }
    };
    var upstream: Upstream = .{};
    var cache = CachedSigningKeyResolver.init(
        std.testing.allocator,
        std.testing.io,
        1,
        .{ .context = &upstream, .resolve_fn = Upstream.resolve },
    );
    defer cache.deinit();
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const first = try cache.port().resolve(a, "did:plc:a", false);
    const hit = try cache.port().resolve(a, "did:plc:a", false);
    try std.testing.expectEqual(@as(u8, 1), first.raw[0]);
    try std.testing.expectEqual(@as(u8, 1), hit.raw[0]);
    try std.testing.expectEqual(@as(usize, 1), upstream.calls);
    const refreshed = try cache.port().resolve(a, "did:plc:a", true);
    try std.testing.expectEqual(@as(u8, 2), refreshed.raw[0]);
    cache.evict("did:plc:a");
    _ = try cache.port().resolve(a, "did:plc:a", false);
    try std.testing.expectEqual(@as(usize, 3), upstream.calls);
    _ = try cache.port().resolve(a, "did:plc:b", false);
    _ = try cache.port().resolve(a, "did:plc:a", false);
    try std.testing.expectEqual(@as(usize, 5), upstream.calls);
}
