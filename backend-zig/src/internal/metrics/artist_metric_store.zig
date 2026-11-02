const std = @import("std");
const artist_metrics = @import("../domain/artist_metrics.zig");

pub const ArtistMetricStore = struct {
    context: *anyopaque,
    get_fn: *const fn (
        *anyopaque,
        std.mem.Allocator,
        []const u8,
        []const u8,
    ) Error!artist_metrics.ArtistMetrics,

    pub const Error = error{
        MetricsUnavailable,
        CorruptMetrics,
        OutOfMemory,
    };

    pub fn get(
        self: ArtistMetricStore,
        allocator: std.mem.Allocator,
        artist_did: []const u8,
        track_collection: []const u8,
    ) Error!artist_metrics.ArtistMetrics {
        return self.get_fn(self.context, allocator, artist_did, track_collection);
    }
};
