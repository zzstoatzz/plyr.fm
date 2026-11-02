const std = @import("std");
const zat = @import("zat");
const playback = @import("../domain/playback.zig");
const track_id = @import("../identity/track_id.zig");
const PlaybackStore = @import("../index/playback_store.zig").PlaybackStore;

pub const Result = union(enum) {
    found: playback.Playback,
    authentication_required,
    invalid_id,
    not_found,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?PlaybackStore,
    expected_collection: []const u8,
    id: []const u8,
) Result {
    const decoded = allocator.alloc(u8, id.len) catch return .unavailable;
    const at_uri = track_id.decode(decoded, id) catch return .invalid_id;
    const parsed = zat.AtUri.parse(at_uri) orelse return .invalid_id;
    const collection = parsed.collection() orelse return .invalid_id;
    if (!std.mem.eql(u8, collection, expected_collection)) return .not_found;

    const configured_store = store orelse return .unavailable;
    const candidate = configured_store.getByUri(allocator, at_uri) catch |err| {
        switch (err) {
            error.CorruptProjection => std.log.err("corrupt playback projection for {s}", .{at_uri}),
            error.IndexUnavailable => std.log.err("playback index unavailable for {s}", .{at_uri}),
            error.OutOfMemory => {},
        }
        return classifyStoreError(err);
    } orelse return .not_found;

    if (candidate.visibility == .supporters or candidate.gate_type != null)
        return .authentication_required;

    const selected = candidate.verified_delivery orelse candidate.authored_delivery;
    return .{ .found = .{
        .track_id = id,
        .record = .{
            .uri = candidate.record_uri,
            .cid = candidate.record_cid,
            .revision = candidate.revision,
        },
        .availability = if (selected) |delivery| .{
            .status = .available,
            .artifact = candidate.artifact,
            .delivery = delivery,
        } else .{
            .status = .unavailable,
            .artifact = candidate.artifact,
        },
    } };
}

fn classifyStoreError(err: PlaybackStore.Error) Result {
    return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
}

const FakeStore = struct {
    expected_uri: []const u8,
    candidate: ?playback.Candidate,

    fn store(self: *FakeStore) PlaybackStore {
        return .{ .context = self, .get_by_uri_fn = getOpaque };
    }

    fn getOpaque(
        context: *anyopaque,
        _: std.mem.Allocator,
        uri: []const u8,
    ) PlaybackStore.Error!?playback.Candidate {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        if (!std.mem.eql(u8, self.expected_uri, uri)) return error.CorruptProjection;
        return self.candidate;
    }
};

fn fixtureCandidate(uri: []const u8) playback.Candidate {
    return .{
        .record_uri = uri,
        .record_cid = "bafyrecord",
        .revision = "3m123rev",
        .visibility = .public,
        .gate_type = null,
        .artifact = null,
        .verified_delivery = null,
        .authored_delivery = .{
            .url = "https://audio.example/track.mp3",
            .media_type = "audio/mpeg",
            .artifact_cid = null,
            .source = .authored_record,
            .integrity = .unverified,
        },
    };
}

test "playback IDs are canonical and delivery preference is explicit" {
    const uri = "at://did:plc:artist/fm.plyr.dev.track/track";
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, uri);
    var value = fixtureCandidate(uri);
    value.verified_delivery = .{
        .url = "https://verified.example/track.mp3",
        .media_type = "audio/mpeg",
        .artifact_cid = "bafyblob",
        .source = .verified_delivery,
        .integrity = .verified_blob_cid,
    };
    var fake: FakeStore = .{ .expected_uri = uri, .candidate = value };
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const result = execute(arena.allocator(), fake.store(), "fm.plyr.dev.track", id);
    try std.testing.expectEqual(playback.DeliverySource.verified_delivery, result.found.availability.delivery.?.source);
    try std.testing.expectEqualStrings("https://verified.example/track.mp3", result.found.availability.delivery.?.url);
    try std.testing.expectEqual(Result.not_found, execute(arena.allocator(), fake.store(), "fm.plyr.track", id));
    try std.testing.expectEqual(Result.invalid_id, execute(arena.allocator(), fake.store(), "fm.plyr.dev.track", "42"));
}

test "anonymous playback denies gates and represents missing delivery" {
    const uri = "at://did:plc:artist/fm.plyr.dev.track/track";
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, uri);
    var value = fixtureCandidate(uri);
    value.gate_type = "any";
    var fake: FakeStore = .{ .expected_uri = uri, .candidate = value };
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectEqual(
        Result.authentication_required,
        execute(arena.allocator(), fake.store(), "fm.plyr.dev.track", id),
    );

    value.gate_type = null;
    value.authored_delivery = null;
    fake.candidate = value;
    const unavailable = execute(arena.allocator(), fake.store(), "fm.plyr.dev.track", id);
    try std.testing.expectEqual(playback.AvailabilityStatus.unavailable, unavailable.found.availability.status);
    try std.testing.expect(unavailable.found.availability.delivery == null);
}

test "playback store errors preserve corruption and availability" {
    try std.testing.expectEqual(Result.internal_error, classifyStoreError(error.CorruptProjection));
    try std.testing.expectEqual(Result.unavailable, classifyStoreError(error.IndexUnavailable));
    try std.testing.expectEqual(Result.unavailable, classifyStoreError(error.OutOfMemory));
}
