//! Read port for a viewer's current, exact-subject liked tracks.

const std = @import("std");
const track = @import("../domain/track.zig");
const scoped_cursor = @import("../identity/scoped_record_cursor.zig");

pub const Request = struct {
    actor_did: []const u8,
    track_collection: []const u8,
    limit: usize,
    after: ?scoped_cursor.Cursor,
};

pub const Item = struct {
    value: track.Track,
    liked_at_us: i64,
    like_uri: []const u8,
};

pub const Store = struct {
    context: *anyopaque,
    list_fn: *const fn (*anyopaque, std.mem.Allocator, Request) Error![]Item,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn list(
        self: Store,
        allocator: std.mem.Allocator,
        request: Request,
    ) Error![]Item {
        return self.list_fn(self.context, allocator, request);
    }
};
