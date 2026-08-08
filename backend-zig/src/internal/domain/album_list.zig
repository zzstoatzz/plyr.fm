const album = @import("album.zig");

pub const AlbumList = struct {
    object: []const u8 = "list",
    data: []const album.Album,
    has_more: bool,
    next_cursor: ?[]const u8,
};
