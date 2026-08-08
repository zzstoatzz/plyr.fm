const std = @import("std");
const zat = @import("zat");
const track = @import("../domain/track.zig");
const track_id = @import("../identity/track_id.zig");
const TrackStore = @import("../index/track_store.zig").TrackStore;

pub const Result = union(enum) {
    found: track.Track,
    invalid_id,
    not_found,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?TrackStore,
    expected_collection: []const u8,
    id: []const u8,
) Result {
    const decoded = allocator.alloc(u8, id.len) catch return .unavailable;
    const at_uri = track_id.decode(decoded, id) catch return .invalid_id;
    const parsed = zat.AtUri.parse(at_uri) orelse return .invalid_id;
    const collection = parsed.collection() orelse return .invalid_id;

    // An ID from another deployment or record family is well formed but is
    // not a resource in this API's track collection.
    if (!std.mem.eql(u8, collection, expected_collection)) return .not_found;

    const configured_store = store orelse return .unavailable;
    const value = configured_store.getByUri(allocator, at_uri) catch |err| {
        switch (err) {
            error.CorruptProjection => std.log.err("corrupt track projection for {s}", .{at_uri}),
            error.IndexUnavailable => std.log.err("track index unavailable for {s}", .{at_uri}),
            error.OutOfMemory => {},
        }
        return classifyStoreError(err);
    };
    return if (value) |found| .{ .found = found } else .not_found;
}

fn classifyStoreError(err: TrackStore.Error) Result {
    return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
}

const FakeStore = struct {
    expected_uri: []const u8,
    value: ?track.Track,

    fn asStore(self: *FakeStore) TrackStore {
        return .{ .context = self, .get_by_uri_fn = getOpaque };
    }

    fn getOpaque(context: *anyopaque, _: std.mem.Allocator, uri: []const u8) TrackStore.Error!?track.Track {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        if (!std.mem.eql(u8, self.expected_uri, uri)) return error.CorruptProjection;
        return self.value;
    }
};

test "lookup is canonical-URI keyed and environment scoped" {
    const allocator = std.testing.allocator;
    const uri = "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/fm.plyr.dev.track/3m123abc";
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, uri);
    var fake = FakeStore{ .expected_uri = uri, .value = null };

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    try std.testing.expectEqual(
        Result.not_found,
        execute(arena.allocator(), fake.asStore(), "fm.plyr.dev.track", id),
    );
    try std.testing.expectEqual(
        Result.not_found,
        execute(arena.allocator(), fake.asStore(), "fm.plyr.track", id),
    );
    try std.testing.expectEqual(
        Result.invalid_id,
        execute(arena.allocator(), fake.asStore(), "fm.plyr.dev.track", "42"),
    );
}

test "store errors preserve corruption versus availability semantics" {
    try std.testing.expectEqual(Result.internal_error, classifyStoreError(error.CorruptProjection));
    try std.testing.expectEqual(Result.unavailable, classifyStoreError(error.IndexUnavailable));
    try std.testing.expectEqual(Result.unavailable, classifyStoreError(error.OutOfMemory));
}
