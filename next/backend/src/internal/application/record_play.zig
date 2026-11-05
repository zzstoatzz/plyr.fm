const std = @import("std");
const zat = @import("zat");
const track_id = @import("../identity/track_id.zig");
const PlayMetricStore = @import("../metrics/play_metric_store.zig").PlayMetricStore;

pub const Receipt = struct {
    object: []const u8 = "play_receipt",
    occurrence: []const u8,
    track_id: []const u8,
    record: struct { uri: []const u8 },
    play_count: i64,
    counted: bool,
    dedup: struct { status: @FieldType(PlayMetricStore.Receipt, "status"), window_seconds: u32 },
    sources: struct {
        metrics: []const u8 = "application_metrics",
        dedup: []const u8 = "postgres_durable",
    } = .{},
};

pub const Result = union(enum) {
    recorded: Receipt,
    invalid_request,
    invalid_id,
    not_found,
    conflict,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    metric_store: ?PlayMetricStore,
    expected_collection: []const u8,
    id: []const u8,
    listener: []const u8,
    occurrence: []const u8,
) Result {
    if (listener.len == 0) return .internal_error;
    if (!validOccurrence(occurrence)) return .invalid_request;
    const decoded = allocator.alloc(u8, id.len) catch return .unavailable;
    const record_uri = track_id.decode(decoded, id) catch return .invalid_id;
    const parsed = zat.AtUri.parse(record_uri) orelse return .invalid_id;
    if (!std.mem.eql(u8, parsed.collection() orelse return .invalid_id, expected_collection))
        return .not_found;
    const metrics = metric_store orelse return .unavailable;
    const outcome = metrics.record(record_uri, occurrence, listener) catch |err| return switch (err) {
        error.CorruptMetrics => .internal_error,
        error.MetricsUnavailable, error.OutOfMemory => .unavailable,
    };
    return switch (outcome) {
        .not_found => .not_found,
        .conflict => .conflict,
        .recorded => |value| .{ .recorded = .{
            .occurrence = occurrence,
            .track_id = id,
            .record = .{ .uri = record_uri },
            .play_count = value.play_count,
            .counted = value.counted,
            .dedup = .{ .status = value.status, .window_seconds = value.window_seconds },
        } },
    };
}

pub fn validOccurrence(value: []const u8) bool {
    if (value.len != 36 or value[14] != '4') return false;
    if (std.mem.indexOfScalar(u8, "89ab", value[19]) == null) return false;
    for (value, 0..) |byte, i| {
        if (i == 8 or i == 13 or i == 18 or i == 23) {
            if (byte != '-') return false;
        } else if (!(std.ascii.isDigit(byte) or (byte >= 'a' and byte <= 'f'))) return false;
    }
    return true;
}

test "occurrences are canonical UUIDv4 and never admit alternate encodings" {
    try std.testing.expect(validOccurrence("01234567-89ab-4def-8123-456789abcdef"));
    try std.testing.expect(!validOccurrence("01234567-89ab-1def-8123-456789abcdef"));
    try std.testing.expect(!validOccurrence("01234567-89ab-4def-7123-456789abcdef"));
    try std.testing.expect(!validOccurrence("01234567-89AB-4def-8123-456789abcdef"));
    try std.testing.expect(!validOccurrence("01234567-89ab-4def-8123-456789abcdef-extra"));
}
