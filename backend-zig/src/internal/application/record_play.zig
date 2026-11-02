const std = @import("std");
const zat = @import("zat");
const track_id = @import("../identity/track_id.zig");
const PlayDedupStore = @import("../metrics/play_dedup_store.zig").PlayDedupStore;
const PlayMetricStore = @import("../metrics/play_metric_store.zig").PlayMetricStore;

const minimum_ttl_seconds: u32 = 30;
const maximum_ttl_seconds: u32 = 60 * 60;
const default_ttl_seconds: u32 = 5 * 60;

pub const Receipt = struct {
    object: []const u8 = "play_receipt",
    track_id: []const u8,
    record: Record,
    play_count: i64,
    counted: bool,
    dedup: Dedup,
    sources: Sources = .{},

    pub const Record = struct { uri: []const u8 };
    pub const Dedup = struct {
        status: Status,
        window_seconds: u32,

        pub const Status = enum { claimed, duplicate, unavailable };
    };
    pub const Sources = struct {
        metrics: []const u8 = "application_metrics",
        dedup: []const u8 = "redis_ephemeral",
    };
};

pub const Result = union(enum) {
    recorded: Receipt,
    invalid_request,
    invalid_id,
    not_found,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    metric_store: ?PlayMetricStore,
    dedup_store: ?PlayDedupStore,
    expected_collection: []const u8,
    id: []const u8,
    listener: Listener,
    ref_code: ?[]const u8,
) Result {
    if (listener.dedup_key.len == 0) return .internal_error;
    if (ref_code) |ref| if (!validRefCode(ref)) return .invalid_request;
    const decoded = allocator.alloc(u8, id.len) catch return .unavailable;
    const record_uri = track_id.decode(decoded, id) catch return .invalid_id;
    const parsed = zat.AtUri.parse(record_uri) orelse return .invalid_id;
    if (!std.mem.eql(u8, parsed.collection() orelse return .invalid_id, expected_collection))
        return .not_found;

    const metrics = metric_store orelse return .unavailable;
    const candidate = metrics.inspect(allocator, record_uri) catch |err|
        return classifyMetricError(err);
    const present = candidate orelse return .not_found;
    if (present.play_count < 0 or
        (present.duration_seconds != null and present.duration_seconds.? < 0))
        return .internal_error;

    const ttl_seconds = dedupTtl(present.duration_seconds);
    const claim_status: Receipt.Dedup.Status = if (dedup_store) |dedup| blk: {
        const claimed = dedup.claim(listener.dedup_key, record_uri, ttl_seconds) catch {
            break :blk .unavailable;
        };
        break :blk if (claimed) .claimed else .duplicate;
    } else .unavailable;

    if (claim_status == .duplicate) return .{ .recorded = .{
        .track_id = id,
        .record = .{ .uri = record_uri },
        .play_count = present.play_count,
        .counted = false,
        .dedup = .{ .status = claim_status, .window_seconds = ttl_seconds },
    } };

    const attribution: ?PlayMetricStore.Attribution = if (ref_code) |ref| .{
        .ref_code = ref,
        .listener_did = listener.did,
    } else null;
    const incremented = metrics.increment(record_uri, attribution) catch |err|
        return classifyMetricError(err);
    const count = incremented orelse return .not_found;
    if (count < 0) return .internal_error;
    return .{ .recorded = .{
        .track_id = id,
        .record = .{ .uri = record_uri },
        .play_count = count,
        .counted = true,
        .dedup = .{ .status = claim_status, .window_seconds = ttl_seconds },
    } };
}

pub const Listener = struct {
    dedup_key: []const u8,
    did: ?[]const u8 = null,
};

fn validRefCode(value: []const u8) bool {
    if (value.len != 8) return false;
    for (value) |byte| if (!(std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '_'))
        return false;
    return true;
}

fn dedupTtl(duration_seconds: ?i64) u32 {
    const duration = duration_seconds orelse default_ttl_seconds;
    return @intCast(std.math.clamp(
        duration,
        @as(i64, minimum_ttl_seconds),
        @as(i64, maximum_ttl_seconds),
    ));
}

fn classifyMetricError(err: PlayMetricStore.Error) Result {
    return switch (err) {
        error.CorruptMetrics => .internal_error,
        error.MetricsUnavailable, error.OutOfMemory => .unavailable,
    };
}

const FakeMetrics = struct {
    candidate: ?PlayMetricStore.Candidate,
    incremented: ?i64,
    inspect_error: ?PlayMetricStore.Error = null,
    increment_error: ?PlayMetricStore.Error = null,
    increments: usize = 0,

    fn store(self: *FakeMetrics) PlayMetricStore {
        return .{ .context = self, .inspect_fn = inspect, .increment_fn = increment };
    }

    fn inspect(
        context: *anyopaque,
        _: std.mem.Allocator,
        _: []const u8,
    ) PlayMetricStore.Error!?PlayMetricStore.Candidate {
        const self: *FakeMetrics = @ptrCast(@alignCast(context));
        if (self.inspect_error) |err| return err;
        return self.candidate;
    }

    fn increment(
        context: *anyopaque,
        _: []const u8,
        _: ?PlayMetricStore.Attribution,
    ) PlayMetricStore.Error!?i64 {
        const self: *FakeMetrics = @ptrCast(@alignCast(context));
        self.increments += 1;
        if (self.increment_error) |err| return err;
        return self.incremented;
    }
};

const FakeDedup = struct {
    claimed: bool,
    failure: bool = false,
    observed_ttl: u32 = 0,

    fn store(self: *FakeDedup) PlayDedupStore {
        return .{ .context = self, .claim_fn = claim };
    }

    fn claim(
        context: *anyopaque,
        _: []const u8,
        _: []const u8,
        ttl: u32,
    ) PlayDedupStore.Error!bool {
        const self: *FakeDedup = @ptrCast(@alignCast(context));
        self.observed_ttl = ttl;
        if (self.failure) return error.DedupUnavailable;
        return self.claimed;
    }
};

fn testId() ![256]u8 {
    var buffer: [256]u8 = undefined;
    const uri = "at://did:plc:artist/fm.plyr.dev.track/3mplay";
    const encoded = try track_id.encode(&buffer, uri);
    @memset(buffer[encoded.len..], 0);
    return buffer;
}

fn encodedSlice(buffer: *const [256]u8) []const u8 {
    return buffer[0 .. std.mem.indexOfScalar(u8, buffer, 0) orelse buffer.len];
}

test "a claimed play increments canonical metrics" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var id_buffer = try testId();
    var metrics = FakeMetrics{
        .candidate = .{ .duration_seconds = 180, .play_count = 4 },
        .incremented = 5,
    };
    var dedup = FakeDedup{ .claimed = true };
    const result = execute(
        arena.allocator(),
        metrics.store(),
        dedup.store(),
        "fm.plyr.dev.track",
        encodedSlice(&id_buffer),
        .{ .dedup_key = "anon:listener" },
        null,
    );
    try std.testing.expect(result == .recorded);
    try std.testing.expect(result.recorded.counted);
    try std.testing.expectEqual(@as(i64, 5), result.recorded.play_count);
    try std.testing.expectEqual(@as(u32, 180), result.recorded.dedup.window_seconds);
    try std.testing.expectEqual(@as(usize, 1), metrics.increments);
}

test "duplicate plays return the current count without a write" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var id_buffer = try testId();
    var metrics = FakeMetrics{
        .candidate = .{ .duration_seconds = 180, .play_count = 4 },
        .incremented = 99,
    };
    var dedup = FakeDedup{ .claimed = false };
    const result = execute(
        arena.allocator(),
        metrics.store(),
        dedup.store(),
        "fm.plyr.dev.track",
        encodedSlice(&id_buffer),
        .{ .dedup_key = "anon:listener" },
        null,
    );
    try std.testing.expect(result == .recorded);
    try std.testing.expect(!result.recorded.counted);
    try std.testing.expectEqual(@as(i64, 4), result.recorded.play_count);
    try std.testing.expectEqual(@as(usize, 0), metrics.increments);
}

test "dedup failure counts and duration windows are clamped" {
    const cases = [_]struct { duration: ?i64, ttl: u32 }{
        .{ .duration = null, .ttl = 300 },
        .{ .duration = 5, .ttl = 30 },
        .{ .duration = 200, .ttl = 200 },
        .{ .duration = 99_999, .ttl = 3_600 },
    };
    for (cases) |case| {
        var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
        defer arena.deinit();
        var id_buffer = try testId();
        var metrics = FakeMetrics{
            .candidate = .{ .duration_seconds = case.duration, .play_count = 0 },
            .incremented = 1,
        };
        var dedup = FakeDedup{ .claimed = false, .failure = true };
        const result = execute(
            arena.allocator(),
            metrics.store(),
            dedup.store(),
            "fm.plyr.dev.track",
            encodedSlice(&id_buffer),
            .{ .dedup_key = "anon:listener" },
            null,
        );
        try std.testing.expect(result == .recorded);
        try std.testing.expect(result.recorded.counted);
        try std.testing.expectEqual(case.ttl, dedup.observed_ttl);
        try std.testing.expectEqual(.unavailable, result.recorded.dedup.status);
    }
}

test "recording rejects local IDs and preserves store failure classes" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var metrics = FakeMetrics{ .candidate = null, .incremented = null };
    try std.testing.expectEqual(
        Result.invalid_id,
        execute(
            arena.allocator(),
            metrics.store(),
            null,
            "fm.plyr.dev.track",
            "42",
            .{ .dedup_key = "anon:listener" },
            null,
        ),
    );

    var id_buffer = try testId();
    metrics.inspect_error = error.CorruptMetrics;
    try std.testing.expectEqual(
        Result.internal_error,
        execute(
            arena.allocator(),
            metrics.store(),
            null,
            "fm.plyr.dev.track",
            encodedSlice(&id_buffer),
            .{ .dedup_key = "anon:listener" },
            null,
        ),
    );
    metrics.inspect_error = error.MetricsUnavailable;
    try std.testing.expectEqual(
        Result.unavailable,
        execute(
            arena.allocator(),
            metrics.store(),
            null,
            "fm.plyr.dev.track",
            encodedSlice(&id_buffer),
            .{ .dedup_key = "anon:listener" },
            null,
        ),
    );
}

test "share references are strict URL-safe codes" {
    try std.testing.expect(validRefCode("abcdEF_1"));
    try std.testing.expect(!validRefCode("short"));
    try std.testing.expect(!validRefCode("abcdef/1"));
}
