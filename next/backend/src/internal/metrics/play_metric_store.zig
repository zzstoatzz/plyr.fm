pub const PlayMetricStore = struct {
    context: *anyopaque,
    record_fn: *const fn (*anyopaque, []const u8, []const u8, []const u8) Error!Outcome,

    pub const Receipt = struct {
        play_count: i64,
        counted: bool,
        status: enum { claimed, duplicate, suppressed },
        window_seconds: u32,
    };

    pub const Outcome = union(enum) { recorded: Receipt, not_found, conflict };
    pub const Error = error{ MetricsUnavailable, CorruptMetrics, OutOfMemory };

    pub fn record(self: PlayMetricStore, record_uri: []const u8, occurrence: []const u8, listener: []const u8) Error!Outcome {
        return self.record_fn(self.context, record_uri, occurrence, listener);
    }
};
