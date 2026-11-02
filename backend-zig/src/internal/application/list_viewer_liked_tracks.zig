const std = @import("std");
const zat = @import("zat");
const track = @import("../domain/track.zig");
const track_list = @import("../domain/track_list.zig");
const scoped_cursor = @import("../identity/scoped_record_cursor.zig");
const query = @import("../http/query.zig");
const store_module = @import("../index/liked_track_store.zig");

pub const default_limit: usize = 50;
pub const maximum_limit: usize = 100;
const cursor_prefix = "lks_";

const Options = struct {
    limit: usize = default_limit,
    cursor: ?[]const u8 = null,
};

pub const Result = union(enum) {
    found: track_list.TrackList,
    invalid_request,
    corrupt_projection,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?store_module.Store,
    actor_did: []const u8,
    track_collection: []const u8,
    target: []const u8,
) Result {
    if (zat.Did.parse(actor_did) == null or zat.Nsid.parse(track_collection) == null)
        return .invalid_request;
    const options = parseOptions(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const after: ?scoped_cursor.Cursor = if (options.cursor) |token| blk: {
        const storage = allocator.alloc(u8, token.len) catch return .unavailable;
        break :blk scoped_cursor.decode(storage, cursor_prefix, actor_did, token) catch
            return .invalid_request;
    } else null;
    const configured = store orelse return .unavailable;
    const requested = options.limit + 1;
    const items = configured.list(allocator, .{
        .actor_did = actor_did,
        .track_collection = track_collection,
        .limit = requested,
        .after = after,
    }) catch |err| return switch (err) {
        error.CorruptProjection => .corrupt_projection,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
    if (items.len > requested) return .corrupt_projection;
    const has_more = items.len > options.limit;
    const visible = items[0..@min(items.len, options.limit)];
    const data = allocator.alloc(track.Track, visible.len) catch return .unavailable;
    for (visible, data) |item, *destination| destination.* = item.value;
    const next_cursor = if (has_more and visible.len != 0)
        scoped_cursor.encode(allocator, cursor_prefix, actor_did, .{
            .created_at_us = visible[visible.len - 1].liked_at_us,
            .at_uri = visible[visible.len - 1].like_uri,
        }) catch return .unavailable
    else
        null;
    return .{ .found = .{
        .data = data,
        .has_more = has_more,
        .next_cursor = next_cursor,
    } };
}

fn parseOptions(allocator: std.mem.Allocator, target: []const u8) !Options {
    var result: Options = .{};
    var saw_limit = false;
    var saw_cursor = false;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "limit")) {
            if (saw_limit or pair.value.len == 0) return error.InvalidQuery;
            saw_limit = true;
            result.limit = std.fmt.parseInt(usize, pair.value, 10) catch
                return error.InvalidQuery;
            if (result.limit == 0 or result.limit > maximum_limit)
                return error.InvalidQuery;
        } else if (std.mem.eql(u8, pair.name, "cursor")) {
            if (saw_cursor or pair.value.len == 0) return error.InvalidQuery;
            saw_cursor = true;
            result.cursor = pair.value;
        } else return error.InvalidQuery;
    }
    return result;
}

test "liked-track options are strict and bounded" {
    try std.testing.expectEqual(
        default_limit,
        (try parseOptions(std.testing.allocator, "/v1/me/likes")).limit,
    );
    try std.testing.expectError(
        error.InvalidQuery,
        parseOptions(std.testing.allocator, "/v1/me/likes?limit=101"),
    );
    try std.testing.expectError(
        error.InvalidQuery,
        parseOptions(std.testing.allocator, "/v1/me/likes?unknown=yes"),
    );
}
