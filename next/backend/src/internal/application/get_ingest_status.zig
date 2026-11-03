//! Freshness of the index for /v1/health/ingest: how far the stream runner
//! trails the network, when the catalog was last reconciled, where label
//! sync stands, and how much audio the mirror still has to copy.

const std = @import("std");
const zat = @import("zat");
const store_module = @import("../index/ingest_status_store.zig");

pub const Checkpoint = struct {
    at: ?[]const u8,
    age_seconds: ?f64,
};

pub const View = struct {
    stream: struct { cursor: Checkpoint, checkpointed: Checkpoint },
    reconcile: Checkpoint,
    labels: struct { seq: ?i64, synced: Checkpoint },
    mirror: struct { pending: u64, retrying: u64, capped: bool },
};

pub const Result = union(enum) {
    found: View,
    unavailable,
    internal_error,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?store_module.IngestStatusStore,
    now_us: i64,
) Result {
    const configured = store orelse return .unavailable;
    const status = configured.get() catch |err| return switch (err) {
        error.IndexUnavailable => .unavailable,
        error.CorruptProjection => .internal_error,
    };
    return .{ .found = view(allocator, status, now_us) catch return .unavailable };
}

pub fn view(allocator: std.mem.Allocator, status: store_module.Status, now_us: i64) !View {
    return .{
        .stream = .{
            .cursor = try checkpoint(allocator, status.stream_cursor_us, now_us),
            .checkpointed = try checkpoint(allocator, status.stream_checkpointed_at_us, now_us),
        },
        .reconcile = try checkpoint(allocator, status.reconciled_at_us, now_us),
        .labels = .{
            .seq = status.label_seq,
            .synced = try checkpoint(allocator, status.label_synced_at_us, now_us),
        },
        .mirror = .{
            .pending = status.mirror_pending,
            .retrying = status.mirror_retrying,
            .capped = status.mirror_pending >= store_module.backlog_cap,
        },
    };
}

/// microseconds of 9999-12-31T23:59:59.999999Z, the last instant
/// `zat.Datetime` renders in four year digits
const last_renderable_us: i64 = 253_402_300_799_999_999;

fn checkpoint(allocator: std.mem.Allocator, then_us: ?i64, now_us: i64) !Checkpoint {
    const then = then_us orelse return .{ .at = null, .age_seconds = null };
    const at: ?[]const u8 = if (then >= 0 and then <= last_renderable_us)
        try allocator.dupe(u8, &zat.Datetime.fromMicros(then).toString())
    else
        null;
    // a checkpoint ahead of this clock reads as current, not negative
    const age_us: i128 = @max(0, @as(i128, now_us) - then);
    return .{ .at = at, .age_seconds = @as(f64, @floatFromInt(age_us)) / std.time.us_per_s };
}

test "ingest status reports ages from checkpoints and never a negative lag" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const status: store_module.Status = .{
        .stream_cursor_us = 1_786_000_000_000_000,
        .stream_checkpointed_at_us = 1_786_000_004_000_000,
        .reconciled_at_us = null,
        .label_seq = 42,
        .label_synced_at_us = 1_786_000_010_000_000,
        .mirror_pending = store_module.backlog_cap,
        .mirror_retrying = 3,
    };
    const got = try view(arena.allocator(), status, 1_786_000_005_500_000);
    try std.testing.expectEqual(@as(?f64, 5.5), got.stream.cursor.age_seconds);
    try std.testing.expectEqualStrings("2026-08-06T07:06:40.000000Z", got.stream.cursor.at.?);
    try std.testing.expectEqual(@as(?f64, 1.5), got.stream.checkpointed.age_seconds);
    try std.testing.expect(got.reconcile.at == null and got.reconcile.age_seconds == null);
    try std.testing.expectEqual(@as(?f64, 0), got.labels.synced.age_seconds);
    try std.testing.expect(got.mirror.capped);
}
