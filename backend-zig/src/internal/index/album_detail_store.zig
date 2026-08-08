//! Storage port for one verified album and its ordered member resolutions.

const std = @import("std");
const album_detail = @import("../domain/album_detail.zig");

pub const Request = struct {
    uri: []const u8,
    list_collection: []const u8,
    track_collection: []const u8,
};

pub const AlbumDetailStore = struct {
    context: *anyopaque,
    get_by_uri_fn: *const fn (
        *anyopaque,
        std.mem.Allocator,
        Request,
    ) Error!?album_detail.AlbumDetail,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn getByUri(
        self: AlbumDetailStore,
        allocator: std.mem.Allocator,
        request: Request,
    ) Error!?album_detail.AlbumDetail {
        return self.get_by_uri_fn(self.context, allocator, request);
    }
};
