//! Relay discovery hints: every repository the relay has seen write one of
//! plyr's collections (`com.atproto.sync.listReposByCollection`). Like the
//! PostgreSQL hints, a DID here only says which repository to snapshot; all
//! records still come from an authenticated repository.

const std = @import("std");
const zat = @import("zat");
const candidates = @import("repository_candidates.zig");

const user_agent = "plyr.fm-zig-discovery/0.1 (+https://plyr.fm)";
/// a hard stop so a misbehaving relay can't page forever
const max_pages_per_collection = 200;

pub const RelayRepositoryCandidates = struct {
    io: std.Io,
    /// https origin, e.g. `https://relay1.us-east.bsky.network`
    relay: []const u8,
    collections: []const []const u8,

    pub fn source(self: *RelayRepositoryCandidates) candidates.Source {
        return .{ .context = self, .list_fn = listOpaque };
    }

    fn listOpaque(context: *anyopaque, allocator: std.mem.Allocator) candidates.Error!candidates.CandidateSet {
        const self: *RelayRepositoryCandidates = @ptrCast(@alignCast(context));
        var transport = zat.HttpTransport.initWithUserAgent(self.io, allocator, user_agent);
        defer transport.deinit();

        var seen: std.StringArrayHashMapUnmanaged(void) = .empty;
        defer seen.deinit(allocator);
        errdefer for (seen.keys()) |key| allocator.free(key);

        for (self.collections) |collection| {
            var cursor: ?[]u8 = null;
            defer if (cursor) |c| allocator.free(c);
            var page: usize = 0;
            while (page < max_pages_per_collection) : (page += 1) {
                var arena_state = std.heap.ArenaAllocator.init(allocator);
                defer arena_state.deinit();
                const arena = arena_state.allocator();
                const url = (if (cursor) |c|
                    std.fmt.allocPrint(arena, "{s}/xrpc/com.atproto.sync.listReposByCollection?collection={s}&limit=2000&cursor={f}", .{ self.relay, collection, std.fmt.alt(std.Uri.Component{ .raw = c }, .formatQuery) })
                else
                    std.fmt.allocPrint(arena, "{s}/xrpc/com.atproto.sync.listReposByCollection?collection={s}&limit=2000", .{ self.relay, collection })) catch return error.OutOfMemory;
                var result = transport.fetch(.{
                    .url = url,
                    .accept = "application/json",
                    .max_response_size = 16 * 1024 * 1024,
                    .on_redirect = .refuse,
                    .deadline_ns = 30 * std.time.ns_per_s,
                }) catch |err| {
                    std.log.err("relay discovery {s} failed: {}", .{ collection, err });
                    return error.SourceUnavailable;
                };
                defer result.deinit(transport.allocator);
                if (result.status != .ok) {
                    std.log.err("relay discovery {s}: HTTP {d}", .{ collection, @backingInt(result.status) });
                    return error.SourceUnavailable;
                }
                const next = try collectPage(allocator, arena, result.body, &seen);
                if (cursor) |c| allocator.free(c);
                cursor = next;
                if (cursor == null) break;
            }
        }
        const items = allocator.alloc([]u8, seen.count()) catch return error.OutOfMemory;
        for (seen.keys(), 0..) |key, index| items[index] = @constCast(key);
        return .{ .items = items };
    }
};

/// Add the page's DIDs to `seen` (owned by `allocator`); return the owned
/// next cursor, or null on the last page.
fn collectPage(
    allocator: std.mem.Allocator,
    arena: std.mem.Allocator,
    body: []const u8,
    seen: *std.StringArrayHashMapUnmanaged(void),
) candidates.Error!?[]u8 {
    const parsed = std.json.parseFromSliceLeaky(std.json.Value, arena, body, .{}) catch return error.CorruptSource;
    if (parsed != .object) return error.CorruptSource;
    const repos = parsed.object.get("repos") orelse return error.CorruptSource;
    if (repos != .array) return error.CorruptSource;
    for (repos.array.items) |repo| {
        if (repo != .object) return error.CorruptSource;
        const did_value = repo.object.get("did") orelse return error.CorruptSource;
        if (did_value != .string) return error.CorruptSource;
        const did = did_value.string;
        if (zat.Did.parse(did) == null) return error.CorruptSource;
        if (seen.contains(did)) continue;
        const owned = allocator.dupe(u8, did) catch return error.OutOfMemory;
        seen.put(allocator, owned, {}) catch {
            allocator.free(owned);
            return error.OutOfMemory;
        };
    }
    const cursor = parsed.object.get("cursor") orelse return null;
    if (cursor != .string or cursor.string.len == 0 or repos.array.items.len == 0) return null;
    return allocator.dupe(u8, cursor.string) catch return error.OutOfMemory;
}

test "relay pages dedupe DIDs and follow cursors" {
    const allocator = std.testing.allocator;
    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    var seen: std.StringArrayHashMapUnmanaged(void) = .empty;
    defer {
        for (seen.keys()) |key| allocator.free(key);
        seen.deinit(allocator);
    }
    const next = (try collectPage(allocator, arena_state.allocator(),
        \\{"repos":[{"did":"did:plc:one"},{"did":"did:plc:two"}],"cursor":"abc"}
    , &seen)).?;
    defer allocator.free(next);
    try std.testing.expectEqualStrings("abc", next);
    try std.testing.expect(try collectPage(allocator, arena_state.allocator(),
        \\{"repos":[{"did":"did:plc:two"},{"did":"did:web:three.example"}]}
    , &seen) == null);
    try std.testing.expectEqual(@as(usize, 3), seen.count());
    try std.testing.expectError(error.CorruptSource, collectPage(allocator, arena_state.allocator(),
        \\{"repos":[{"did":"not a did"}]}
    , &seen));
}
