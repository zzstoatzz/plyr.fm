const std = @import("std");

/// Application-owned play aggregates are keyed by the canonical record URI.
/// The adapter may mirror a count into transitional storage, but callers do
/// not know whether a local track row exists.
pub const PlayMetricStore = struct {
    context: *anyopaque,
    inspect_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) Error!?Candidate,
    increment_fn: *const fn (*anyopaque, []const u8, ?Attribution) Error!?i64,

    pub const Candidate = struct {
        duration_seconds: ?i64,
        play_count: i64,
    };

    pub const Attribution = struct {
        ref_code: []const u8,
        listener_did: ?[]const u8,
    };

    pub const Error = error{
        MetricsUnavailable,
        CorruptMetrics,
        OutOfMemory,
    };

    pub fn inspect(
        self: PlayMetricStore,
        allocator: std.mem.Allocator,
        record_uri: []const u8,
    ) Error!?Candidate {
        return self.inspect_fn(self.context, allocator, record_uri);
    }

    pub fn increment(
        self: PlayMetricStore,
        record_uri: []const u8,
        attribution: ?Attribution,
    ) Error!?i64 {
        return self.increment_fn(self.context, record_uri, attribution);
    }
};
