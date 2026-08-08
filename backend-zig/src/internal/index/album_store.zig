const std = @import("std");
const album = @import("../domain/album.zig");
const record_cursor = @import("../identity/record_cursor.zig");

pub const ListRequest = struct {
    collection: []const u8,
    artist_did: []const u8,
    limit: usize,
    after: ?record_cursor.Cursor,
};

pub const ListItem = struct {
    value: album.Album,
    created_at_us: i64,
};

pub const AlbumStore = struct {
    context: *anyopaque,
    list_by_artist_fn: *const fn (*anyopaque, std.mem.Allocator, ListRequest) Error![]ListItem,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn listByArtist(
        self: AlbumStore,
        allocator: std.mem.Allocator,
        request: ListRequest,
    ) Error![]ListItem {
        return self.list_by_artist_fn(self.context, allocator, request);
    }
};
