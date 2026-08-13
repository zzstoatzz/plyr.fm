//! Resolve authenticated viewer state without personalizing public tracks.

const std = @import("std");
const zat = @import("zat");
const track = @import("../domain/track.zig");
const track_id = @import("../identity/track_id.zig");
const viewer_store = @import("../index/viewer_like_store.zig");

pub const maximum_tracks = 100;

pub const Input = struct {
    track_id: []const u8,
    record_cid: []const u8,
};

pub const State = struct {
    track_id: []const u8,
    liked: bool,
};

pub const Response = struct {
    object: []const u8 = "viewer_like_states",
    data: []const State,
    sources: Sources = .{},

    pub const Sources = struct {
        likes: track.Source = .verified_repo,
    };
};

pub const Result = union(enum) {
    found: Response,
    invalid_request,
    corrupt_projection,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?viewer_store.Store,
    actor_did: []const u8,
    track_collection: []const u8,
    like_collection: []const u8,
    inputs: []const Input,
) Result {
    if (zat.Did.parse(actor_did) == null or
        zat.Nsid.parse(track_collection) == null or
        zat.Nsid.parse(like_collection) == null or
        inputs.len == 0 or
        inputs.len > maximum_tracks)
        return .invalid_request;

    var seen = std.StringHashMap(void).init(allocator);
    defer seen.deinit();
    const subjects = allocator.alloc(viewer_store.Subject, inputs.len) catch return .unavailable;
    for (inputs, subjects) |input, *subject| {
        const entry = seen.getOrPut(input.track_id) catch return .unavailable;
        if (entry.found_existing) return .invalid_request;
        const decoded = allocator.alloc(u8, input.track_id.len) catch return .unavailable;
        const uri = track_id.decode(decoded, input.track_id) catch return .invalid_request;
        const parsed_uri = zat.AtUri.parse(uri) orelse return .invalid_request;
        if (!std.mem.eql(
            u8,
            parsed_uri.collection() orelse return .invalid_request,
            track_collection,
        )) return .invalid_request;
        const cid = zat.Cid.fromString(allocator, input.record_cid) catch return .invalid_request;
        defer allocator.free(cid.raw);
        if (cid.codec() != zat.cbor.Codec.dag_cbor) return .invalid_request;
        subject.* = .{ .uri = uri, .cid = input.record_cid };
    }

    const configured = store orelse return .unavailable;
    const resolved = configured.resolve(allocator, .{
        .actor_did = actor_did,
        .like_collection = like_collection,
        .subjects = subjects,
    }) catch |err| return switch (err) {
        error.CorruptProjection => .corrupt_projection,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
    if (resolved.len != inputs.len) return .corrupt_projection;
    const states = allocator.alloc(State, inputs.len) catch return .unavailable;
    for (inputs, resolved, states) |input, liked, *state|
        state.* = .{ .track_id = input.track_id, .liked = liked };
    return .{ .found = .{ .data = states } };
}

const FakeStore = struct {
    values: []const bool,

    fn store(self: *FakeStore) viewer_store.Store {
        return .{ .context = self, .resolve_fn = resolve };
    }

    fn resolve(
        context: *anyopaque,
        _: std.mem.Allocator,
        request: viewer_store.Request,
    ) viewer_store.Store.Error![]const bool {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        if (self.values.len != request.subjects.len) return error.CorruptProjection;
        return self.values;
    }
};

test "viewer like state preserves request identity and exact projection order" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var id_a: [256]u8 = undefined;
    var id_b: [256]u8 = undefined;
    const first = try track_id.encode(&id_a, "at://did:plc:artist/fm.plyr.dev.track/a");
    const second = try track_id.encode(&id_b, "at://did:plc:artist/fm.plyr.dev.track/b");
    const cid = "bafyreihdcss27ihlhmjofustbdvksrwyxnjj3hhk7azqs2626paka66c2a";
    const values = [_]bool{ true, false };
    var fake = FakeStore{ .values = &values };
    const result = execute(
        allocator,
        fake.store(),
        "did:plc:listener",
        "fm.plyr.dev.track",
        "fm.plyr.dev.like",
        &.{
            .{ .track_id = first, .record_cid = cid },
            .{ .track_id = second, .record_cid = cid },
        },
    ).found;
    try std.testing.expectEqualStrings(first, result.data[0].track_id);
    try std.testing.expect(result.data[0].liked);
    try std.testing.expectEqualStrings(second, result.data[1].track_id);
    try std.testing.expect(!result.data[1].liked);
}

test "viewer like state rejects duplicates and non-track strong references" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, "at://did:plc:artist/fm.plyr.dev.track/a");
    const cid = "bafyreihdcss27ihlhmjofustbdvksrwyxnjj3hhk7azqs2626paka66c2a";
    var fake = FakeStore{ .values = &.{} };
    try std.testing.expectEqual(Result.invalid_request, execute(
        allocator,
        fake.store(),
        "did:plc:listener",
        "fm.plyr.dev.track",
        "fm.plyr.dev.like",
        &.{
            .{ .track_id = id, .record_cid = cid },
            .{ .track_id = id, .record_cid = cid },
        },
    ));
}
