const std = @import("std");
const query = @import("../http/query.zig");
const index = @import("../index/track_store.zig");

pub const Result = union(enum) {
    found: struct { object: []const u8 = "list", data: []const index.Tag },
    invalid_request,
    unavailable,
    internal_error,
};

pub fn execute(allocator: std.mem.Allocator, store: ?index.TrackStore, collection: []const u8, target: []const u8) Result {
    var limit: usize = 15;
    var saw_limit = false;
    var pairs = query.Iterator.init(allocator, target);
    while (pairs.next() catch return .invalid_request) |pair| {
        if (!std.mem.eql(u8, pair.name, "limit") or saw_limit) return .invalid_request;
        saw_limit = true;
        limit = query.parseDecimal(usize, pair.value) catch return .invalid_request;
        if (limit < 1 or limit > 100) return .invalid_request;
    }
    const configured = store orelse return .unavailable;
    const data = configured.listTags(allocator, collection, limit) catch |err| return switch (err) {
        error.CorruptProjection => .internal_error,
        else => .unavailable,
    };
    return .{ .found = .{ .data = data } };
}
