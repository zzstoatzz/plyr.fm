const std = @import("std");
const zat = @import("zat");
const track = @import("../domain/track.zig");
const track_id = @import("../identity/track_id.zig");
const TrackStore = @import("../index/track_store.zig").TrackStore;

pub const Result = union(enum) {
    found: struct { object: []const u8 = "list", data: []const track.Track, missing: []const []const u8 },
    invalid_request,
    unavailable,
    internal_error,
};

pub fn execute(a: std.mem.Allocator, store: ?TrackStore, collection: []const u8, ids: []const []const u8) Result {
    if (ids.len > 100) return .invalid_request;
    var requested: std.ArrayList(struct { id: []const u8, uri: []const u8, scoped: bool }) = .empty;
    var uris: std.ArrayList([]const u8) = .empty;
    for (ids) |id| {
        if (id.len == 0 or id.len > 2048) return .invalid_request;
        const buffer = a.alloc(u8, id.len) catch return .unavailable;
        const uri = track_id.decode(buffer, id) catch return .invalid_request;
        const parsed = zat.AtUri.parse(uri) orelse return .invalid_request;
        var seen = false;
        for (requested.items) |previous| if (std.mem.eql(u8, previous.uri, uri)) {
            seen = true;
            break;
        };
        if (seen) continue;
        const scoped = std.mem.eql(u8, parsed.collection() orelse return .invalid_request, collection);
        requested.append(a, .{ .id = id, .uri = uri, .scoped = scoped }) catch return .unavailable;
        if (scoped) uris.append(a, uri) catch return .unavailable;
    }
    const resolved = if (uris.items.len == 0) &.{} else (store orelse return .unavailable).resolve(a, uris.items) catch |err| return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
    if (resolved.len > uris.items.len) return .internal_error;
    for (resolved) |value| {
        var expected = false;
        for (uris.items) |uri| if (std.mem.eql(u8, uri, value.record.uri)) {
            expected = true;
            break;
        };
        if (!expected) return .internal_error;
    }
    var data: std.ArrayList(track.Track) = .empty;
    var missing: std.ArrayList([]const u8) = .empty;
    for (requested.items) |request| {
        var found: ?track.Track = null;
        if (request.scoped) for (resolved) |value| {
            if (std.mem.eql(u8, value.record.uri, request.uri)) {
                found = value;
                break;
            }
        };
        if (found) |value| data.append(a, value) catch return .unavailable else missing.append(a, request.id) catch return .unavailable;
    }
    return .{ .found = .{ .data = data.toOwnedSlice(a) catch return .unavailable, .missing = missing.toOwnedSlice(a) catch return .unavailable } };
}

test "batch hydration rejects malformed or excessive IDs before accessing storage" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    try std.testing.expectEqual(.invalid_request, execute(a, null, "fm.plyr.dev.track", &.{"wrong"}));
    var excessive: [101][]const u8 = undefined;
    @memset(&excessive, "");
    try std.testing.expectEqual(.invalid_request, execute(a, null, "fm.plyr.dev.track", &excessive));
    const empty = execute(a, null, "fm.plyr.dev.track", &.{}).found;
    try std.testing.expectEqual(@as(usize, 0), empty.data.len);
    var buffer: [512]u8 = undefined;
    const other = try track_id.encode(&buffer, "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/fm.plyr.track/other");
    const result = execute(a, null, "fm.plyr.dev.track", &.{other}).found;
    try std.testing.expectEqualStrings(other, result.missing[0]);
}
