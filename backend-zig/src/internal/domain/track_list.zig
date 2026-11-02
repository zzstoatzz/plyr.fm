const track = @import("track.zig");

pub const TrackList = struct {
    object: []const u8 = "list",
    data: []const track.Track,
    has_more: bool,
    next_cursor: ?[]const u8,
};
