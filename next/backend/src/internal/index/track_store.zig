const std = @import("std");
const track = @import("../domain/track.zig");
const track_cursor = @import("../identity/track_cursor.zig");

pub const ListRequest = struct {
    collection: []const u8,
    scope: ListScope,
    limit: usize,
    after: ?track_cursor.Cursor,
};

pub const ListScope = union(enum) {
    discovery,
    artist: []const u8,
};

pub const ListItem = struct {
    value: track.Track,
    created_at_us: i64,
};

pub const TrackStore = struct {
    context: *anyopaque,
    get_by_uri_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) Error!?track.Track,
    list_public_fn: *const fn (*anyopaque, std.mem.Allocator, ListRequest) Error![]ListItem,
    ready_fn: *const fn (*anyopaque) bool,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn getByUri(
        self: TrackStore,
        allocator: std.mem.Allocator,
        at_uri: []const u8,
    ) Error!?track.Track {
        return self.get_by_uri_fn(self.context, allocator, at_uri);
    }

    pub fn listPublic(
        self: TrackStore,
        allocator: std.mem.Allocator,
        request: ListRequest,
    ) Error![]ListItem {
        return self.list_public_fn(self.context, allocator, request);
    }

    pub fn ready(self: TrackStore) bool {
        return self.ready_fn(self.context);
    }
};
