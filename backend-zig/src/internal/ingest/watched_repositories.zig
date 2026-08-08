//! In-memory interest set loaded from durable authenticated repository heads.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");

pub const WatchedRepositories = struct {
    allocator: std.mem.Allocator,
    entries: std.StringHashMapUnmanaged(void) = .empty,

    pub fn init(allocator: std.mem.Allocator) WatchedRepositories {
        return .{ .allocator = allocator };
    }

    pub fn load(allocator: std.mem.Allocator, pool: *pg.Pool) !WatchedRepositories {
        var watched = init(allocator);
        errdefer watched.deinit();
        var result = pool.query(load_sql, .{}) catch |err| {
            std.log.err("watched repository load failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        defer result.deinit();
        while (result.next() catch |err| {
            std.log.err("watched repository read failed: {}", .{err});
            return error.ProjectionUnavailable;
        }) |row| {
            const did = row.get([]const u8, 0) catch return error.CorruptProjection;
            try watched.add(did);
        }
        return watched;
    }

    pub fn deinit(self: *WatchedRepositories) void {
        var iterator = self.entries.keyIterator();
        while (iterator.next()) |key| self.allocator.free(key.*);
        self.entries.deinit(self.allocator);
    }

    pub fn contains(self: *const WatchedRepositories, did: []const u8) bool {
        return self.entries.contains(did);
    }

    pub fn add(self: *WatchedRepositories, did: []const u8) !void {
        if (zat.Did.parse(did) == null) return error.InvalidIdentity;
        if (self.entries.contains(did)) return;
        const owned = try self.allocator.dupe(u8, did);
        errdefer self.allocator.free(owned);
        try self.entries.put(self.allocator, owned, {});
    }

    pub fn count(self: *const WatchedRepositories) usize {
        return self.entries.count();
    }
};

const load_sql =
    \\SELECT repo_did FROM plyr_index.repo_heads ORDER BY repo_did
;

test "watched repository set owns unique validated identities" {
    var watched = WatchedRepositories.init(std.testing.allocator);
    defer watched.deinit();
    try watched.add("did:plc:a");
    try watched.add("did:plc:a");
    try watched.add("did:web:example.com");
    try std.testing.expectEqual(@as(usize, 2), watched.count());
    try std.testing.expect(watched.contains("did:plc:a"));
    try std.testing.expectError(error.InvalidIdentity, watched.add("not-a-did"));
}
