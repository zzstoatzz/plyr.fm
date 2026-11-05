const std = @import("std");
const zat = @import("zat");
const index = @import("../index/artist_store.zig");

pub const Result = union(enum) {
    found: struct { object: []const u8 = "list", data: []const index.Summary },
    invalid_request,
    unavailable,
    internal_error,
};

pub fn execute(allocator: std.mem.Allocator, store: ?index.ArtistStore, collection: []const u8, dids: []const []const u8) Result {
    if (dids.len > 500) return .invalid_request;
    var unique: std.ArrayList([]const u8) = .empty;
    for (dids) |did| {
        if (did.len > 2048 or zat.Did.parse(did) == null) return .invalid_request;
        var seen = false;
        for (unique.items) |existing| {
            if (std.mem.eql(u8, did, existing)) {
                seen = true;
                break;
            }
        }
        if (!seen) unique.append(allocator, did) catch return .unavailable;
    }
    if (unique.items.len == 0) return .{ .found = .{ .data = &.{} } };
    const configured = store orelse return .unavailable;
    const data = configured.resolve(allocator, unique.items, collection) catch |err| return switch (err) {
        error.CorruptProjection => .internal_error,
        else => .unavailable,
    };
    return .{ .found = .{ .data = data } };
}

test "artist batch validates all identifiers and bounds before storage" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectEqual(Result.invalid_request, execute(arena.allocator(), null, "fm.plyr.dev.track", &.{"not-a-did"}));
    var excessive: [501][]const u8 = undefined;
    @memset(&excessive, "did:plc:artist");
    try std.testing.expectEqual(Result.invalid_request, execute(arena.allocator(), null, "fm.plyr.dev.track", &excessive));
    const empty = execute(arena.allocator(), null, "fm.plyr.dev.track", &.{});
    try std.testing.expectEqual(@as(usize, 0), empty.found.data.len);
}
