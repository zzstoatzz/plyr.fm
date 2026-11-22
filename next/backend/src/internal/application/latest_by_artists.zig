const std = @import("std");
const zat = @import("zat");
const track = @import("../domain/track.zig");
const TrackStore = @import("../index/track_store.zig").TrackStore;

pub const max_dids: usize = 500;
pub const default_limit: usize = 12;
pub const max_limit: usize = 50;

pub const Result = union(enum) {
    found: struct { object: []const u8 = "list", data: []const track.Track },
    invalid_request,
    unavailable,
    internal_error,
};

/// The newest listed track from each of `dids`, newest first, at most `limit`
/// of them: one read for a "new from people you know" shelf.
pub fn execute(allocator: std.mem.Allocator, store: ?TrackStore, collection: []const u8, dids: []const []const u8, limit: ?usize) Result {
    const wanted = limit orelse default_limit;
    if (wanted < 1 or wanted > max_limit or dids.len > max_dids) return .invalid_request;
    var unique: std.ArrayList([]const u8) = .empty;
    for (dids) |did| {
        if (did.len > 2048 or zat.Did.parse(did) == null) return .invalid_request;
        var seen = false;
        for (unique.items) |existing| if (std.mem.eql(u8, did, existing)) {
            seen = true;
            break;
        };
        if (!seen) unique.append(allocator, did) catch return .unavailable;
    }
    if (unique.items.len == 0) return .{ .found = .{ .data = &.{} } };
    const configured = store orelse return .unavailable;
    const data = configured.latestByArtists(allocator, collection, unique.items, wanted) catch |err| return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
    if (data.len > wanted) return .internal_error;
    for (data, 0..) |value, index| {
        var requested = false;
        for (unique.items) |did| if (std.mem.eql(u8, did, value.artist.did)) {
            requested = true;
            break;
        };
        if (!requested) return .internal_error;
        for (data[0..index]) |earlier| if (std.mem.eql(u8, earlier.artist.did, value.artist.did)) return .internal_error;
    }
    return .{ .found = .{ .data = data } };
}

test "latest by artists validates identifiers and bounds before storage" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    try std.testing.expectEqual(Result.invalid_request, execute(a, null, "fm.plyr.dev.track", &.{"not-a-did"}, null));
    try std.testing.expectEqual(Result.invalid_request, execute(a, null, "fm.plyr.dev.track", &.{"did:plc:artist"}, 0));
    try std.testing.expectEqual(Result.invalid_request, execute(a, null, "fm.plyr.dev.track", &.{"did:plc:artist"}, max_limit + 1));
    var excessive: [max_dids + 1][]const u8 = undefined;
    @memset(&excessive, "did:plc:artist");
    try std.testing.expectEqual(Result.invalid_request, execute(a, null, "fm.plyr.dev.track", &excessive, null));
    try std.testing.expectEqual(@as(usize, 0), execute(a, null, "fm.plyr.dev.track", &.{}, null).found.data.len);
    try std.testing.expectEqual(Result.unavailable, execute(a, null, "fm.plyr.dev.track", &.{"did:plc:artist"}, null));
}
