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
    pub const Error = error{ MetricsUnavailable, CorruptMetrics };

    pub fn get(self: Store) Error!Stats {
        return self.get_fn(self.context);
    }
};

test {
    _ = std;
}
