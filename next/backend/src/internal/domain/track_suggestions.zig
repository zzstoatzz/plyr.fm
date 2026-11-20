const track = @import("track.zig");

/// Tracks that tend to go with a set of seed tracks, best first.
pub const Suggestions = struct {
    object: []const u8 = "track_suggestions",
    data: []track.Track,
};
