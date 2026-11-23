const std = @import("std");

pub const Stats = struct {
    object: []const u8 = "platform_stats",
    tracks: u64,
    artists: u64,
    duration_seconds: u64,
    plays: u64,
    updated_at_ms: i64,
};

pub const Store = struct {
    context: *anyopaque,
    get_fn: *const fn (*anyopaque) Error!Stats,
    atlas_fn: *const fn (*anyopaque, std.mem.Allocator) Error!?[]const u8,
    pub const Error = error{ MetricsUnavailable, CorruptMetrics };

    pub fn get(self: Store) Error!Stats {
        return self.get_fn(self.context);
    }

    /// The latest atlas map as JSON text, built by next/scripts/build-atlas.py;
    /// null until the first build lands.
    pub fn atlas(self: Store, allocator: std.mem.Allocator) Error!?[]const u8 {
        return self.atlas_fn(self.context, allocator);
    }
};

test {
    _ = std;
}
