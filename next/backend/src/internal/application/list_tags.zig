const std = @import("std");
const query = @import("../http/query.zig");
const cursor = @import("../identity/tag_cursor.zig");
const index = @import("../index/track_store.zig");

pub const Result = union(enum) {
    found: struct { object: []const u8 = "list", data: []const index.Tag, has_more: bool, next_cursor: ?[]const u8 },
    invalid_request,
    unavailable,
    internal_error,
};

pub fn execute(allocator: std.mem.Allocator, store: ?index.TrackStore, collection: []const u8, target: []const u8) Result {
    var limit: usize = 15;
    var saw_limit = false;
    var token: ?[]const u8 = null;
    var storage: [209]u8 = undefined;
    var pairs = query.Iterator.init(allocator, target);
    while (pairs.next() catch return .invalid_request) |pair| {
        if (std.mem.eql(u8, pair.name, "limit") and !saw_limit) {
            saw_limit = true;
            limit = query.parseDecimal(usize, pair.value) catch return .invalid_request;
            if (limit < 1 or limit > 100) return .invalid_request;
        } else if (std.mem.eql(u8, pair.name, "cursor") and token == null and pair.value.len > 0) {
            token = pair.value;
        } else return .invalid_request;
    }
    const after = if (token) |t| cursor.decode(&storage, t) catch return .invalid_request else null;
    const configured = store orelse return .unavailable;
    const data = configured.listTags(allocator, collection, limit + 1, after) catch |err| return switch (err) {
        error.CorruptProjection => .internal_error,
        else => .unavailable,
    };
    const has_more = data.len > limit;
    const visible = data[0..@min(limit, data.len)];
    const next = if (has_more) cursor.encode(allocator, .{ .plays = visible[visible.len - 1].total_plays, .name = visible[visible.len - 1].name }) catch return .internal_error else null;
    return .{ .found = .{ .data = visible, .has_more = has_more, .next_cursor = next } };
}
