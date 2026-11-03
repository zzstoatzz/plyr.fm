//! Read-after-write for clients that write straight to their PDS.
//!
//! The appview never writes records. A client that just created, updated, or
//! deleted a record on its PDS calls this to block (bounded) until the
//! ingester has projected that exact version, the way tangled's bobbin
//! `awaitRecord` works:
//!
//! - `cid` given: wait until the projection holds that CID, or has rejected
//!   it (the client should surface the rejection).
//! - `cid` omitted: wait until the record is gone (deleted or never indexed).
//!
//! On timeout the answer is `pending`, which is not an error: the write is on
//! the PDS and will be projected; the client may poll again.

const std = @import("std");
const zat = @import("zat");
const query = @import("../http/query.zig");
const store_module = @import("../index/record_status_store.zig");
const RecordStatusStore = store_module.RecordStatusStore;

pub const default_timeout_ms: u32 = 5_000;
pub const max_timeout_ms: u32 = 10_000;
pub const poll_interval_ms: u32 = 150;

pub const Collections = struct {
    track: []const u8,
    list: []const u8,
    like: []const u8,
    profile: []const u8,

    fn contains(self: Collections, collection: []const u8) bool {
        inline for (.{ "track", "list", "like", "profile" }) |field| {
            if (std.mem.eql(u8, @field(self, field), collection)) return true;
        }
        return false;
    }
};

pub const Outcome = enum { indexed, deleted, absent, rejected, pending };

pub const Answer = struct {
    uri: []const u8,
    status: Outcome,
    cid: ?[]const u8 = null,
    reason: ?[]const u8 = null,
};

pub const Result = union(enum) {
    found: Answer,
    invalid_request,
    internal_error,
    unavailable,
};

const Options = struct {
    uri: []const u8,
    cid: ?[]const u8,
    timeout_ms: u32,
};

pub fn execute(
    allocator: std.mem.Allocator,
    io: std.Io,
    store: ?RecordStatusStore,
    collections: Collections,
    target: []const u8,
) Result {
    const options = parseOptions(allocator, target, collections) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const configured = store orelse return .unavailable;
    const started = std.Io.Timestamp.now(io, .awake);
    while (true) {
        const status = configured.get(allocator, options.uri) catch |err| return switch (err) {
            error.CorruptProjection => .internal_error,
            error.IndexUnavailable, error.OutOfMemory => .unavailable,
        };
        if (settled(options.cid, status)) |answer| {
            var value = answer;
            value.uri = options.uri;
            return .{ .found = value };
        }
        const elapsed_ns = started.durationTo(std.Io.Timestamp.now(io, .awake)).nanoseconds;
        const elapsed_ms: i96 = @divFloor(elapsed_ns, std.time.ns_per_ms);
        if (elapsed_ms + poll_interval_ms > options.timeout_ms) break;
        io.sleep(std.Io.Duration.fromMilliseconds(poll_interval_ms), .awake) catch break;
    }
    return .{ .found = .{ .uri = options.uri, .status = .pending, .cid = options.cid } };
}

fn settled(want_cid: ?[]const u8, status: ?store_module.Status) ?Answer {
    if (want_cid) |cid| {
        const current = status orelse return null;
        const current_cid = current.record_cid orelse return null;
        if (!std.mem.eql(u8, current_cid, cid)) return null;
        return switch (current.state) {
            .indexed => .{ .uri = "", .status = .indexed, .cid = current_cid },
            .rejected => .{ .uri = "", .status = .rejected, .cid = current_cid, .reason = current.reason },
            .deleted => null,
        };
    }
    const current = status orelse return .{ .uri = "", .status = .absent };
    return switch (current.state) {
        .deleted => .{ .uri = "", .status = .deleted },
        .indexed, .rejected => null,
    };
}

fn parseOptions(
    allocator: std.mem.Allocator,
    target: []const u8,
    collections: Collections,
) !Options {
    var uri: ?[]const u8 = null;
    var cid: ?[]const u8 = null;
    var timeout_ms: ?u32 = null;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "uri")) {
            if (uri != null) return error.InvalidQuery;
            uri = pair.value;
        } else if (std.mem.eql(u8, pair.name, "cid")) {
            if (cid != null or pair.value.len == 0) return error.InvalidQuery;
            cid = pair.value;
        } else if (std.mem.eql(u8, pair.name, "timeout_ms")) {
            if (timeout_ms != null) return error.InvalidQuery;
            timeout_ms = std.fmt.parseInt(u32, pair.value, 10) catch return error.InvalidQuery;
            if (timeout_ms.? > max_timeout_ms) return error.InvalidQuery;
        } else return error.InvalidQuery;
    }
    const record_uri = uri orelse return error.InvalidQuery;
    const parsed = zat.AtUri.parse(record_uri) orelse return error.InvalidQuery;
    if (zat.Did.parse(parsed.authority()) == null or !parsed.hasRkey()) return error.InvalidQuery;
    const collection = parsed.collection() orelse return error.InvalidQuery;
    if (!collections.contains(collection)) return error.InvalidQuery;
    if (cid) |text| {
        const decoded = zat.Cid.fromString(allocator, text) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.InvalidQuery,
        };
        allocator.free(decoded.raw);
    }
    return .{ .uri = record_uri, .cid = cid, .timeout_ms = timeout_ms orelse default_timeout_ms };
}

const FakeStore = struct {
    statuses: []const ?store_module.Status,
    calls: usize = 0,

    fn store(self: *FakeStore) RecordStatusStore {
        return .{ .context = self, .get_fn = get };
    }

    fn get(context: *anyopaque, _: std.mem.Allocator, _: []const u8) RecordStatusStore.Error!?store_module.Status {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        const index = @min(self.calls, self.statuses.len - 1);
        self.calls += 1;
        return self.statuses[index];
    }
};

const test_collections: Collections = .{
    .track = "fm.plyr.dev.track",
    .list = "fm.plyr.dev.list",
    .like = "fm.plyr.dev.like",
    .profile = "fm.plyr.dev.actor.profile",
};

test "await returns once the exact cid is projected" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var threaded = std.Io.Threaded.init(std.testing.allocator, .{});
    defer threaded.deinit();
    const cid = try (try zat.Cid.forDagCbor(a, "like")).toString(a);
    const old = try (try zat.Cid.forDagCbor(a, "old")).toString(a);
    var fake: FakeStore = .{ .statuses = &.{
        null,
        .{ .state = .indexed, .record_cid = old, .reason = null },
        .{ .state = .indexed, .record_cid = cid, .reason = null },
    } };
    const target = try std.fmt.allocPrint(
        a,
        "/v1/records/await?uri=at://did:plc:a/fm.plyr.dev.like/3k&cid={s}&timeout_ms=2000",
        .{cid},
    );
    const result = execute(a, threaded.io(), fake.store(), test_collections, target);
    try std.testing.expectEqual(Outcome.indexed, result.found.status);
    try std.testing.expectEqual(@as(usize, 3), fake.calls);
}

test "await without cid waits for the record to disappear; times out as pending" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var threaded = std.Io.Threaded.init(std.testing.allocator, .{});
    defer threaded.deinit();
    var gone: FakeStore = .{ .statuses = &.{
        .{ .state = .indexed, .record_cid = "bafyx", .reason = null },
        .{ .state = .deleted, .record_cid = null, .reason = null },
    } };
    const deleted = execute(a, threaded.io(), gone.store(), test_collections, "/v1/records/await?uri=at://did:plc:a/fm.plyr.dev.like/3k");
    try std.testing.expectEqual(Outcome.deleted, deleted.found.status);

    var stuck: FakeStore = .{ .statuses = &.{.{ .state = .indexed, .record_cid = "bafyx", .reason = null }} };
    const pending = execute(a, threaded.io(), stuck.store(), test_collections, "/v1/records/await?uri=at://did:plc:a/fm.plyr.dev.like/3k&timeout_ms=0");
    try std.testing.expectEqual(Outcome.pending, pending.found.status);
    try std.testing.expectEqual(@as(usize, 1), stuck.calls);
}

test "await rejects foreign collections, bad cids, and oversized timeouts" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var threaded = std.Io.Threaded.init(std.testing.allocator, .{});
    defer threaded.deinit();
    var fake: FakeStore = .{ .statuses = &.{null} };
    for ([_][]const u8{
        "/v1/records/await",
        "/v1/records/await?uri=at://did:plc:a/app.bsky.feed.like/3k",
        "/v1/records/await?uri=at://did:plc:a/fm.plyr.dev.like/3k&cid=nope",
        "/v1/records/await?uri=at://did:plc:a/fm.plyr.dev.like/3k&timeout_ms=60000",
        "/v1/records/await?uri=at://did:plc:a/fm.plyr.dev.like/3k&extra=1",
    }) |target| {
        try std.testing.expect(execute(a, threaded.io(), fake.store(), test_collections, target) == .invalid_request);
    }
}
