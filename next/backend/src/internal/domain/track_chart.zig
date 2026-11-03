const track = @import("track.zig");

pub const Period = enum {
    all_time,
    month,
    week,
    day,
};

pub const Entry = struct {
    rank: usize,
    period_like_count: i64,
    all_time_like_count: i64,
    track: track.Track,
};

pub const Chart = struct {
    object: []const u8 = "track_chart",
    period: Period,
    data: []Entry,
};
