const std = @import("std");
const zat = @import("zat");
const verified_list = @import("../domain/verified_list.zig");
const playlist_id = @import("../identity/playlist_id.zig");
const store_module = @import("../index/verified_list_store.zig");
const VerifiedListStore = store_module.VerifiedListStore;

pub const Result = union(enum) {
    found: verified_list.Detail,
    invalid_id,
    not_found,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?VerifiedListStore,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    id: []const u8,
) Result {
    const decoded = allocator.alloc(u8, id.len) catch return .unavailable;
    const uri = playlist_id.decode(decoded, id) catch return .invalid_id;
    const parsed = zat.AtUri.parse(uri) orelse return .invalid_id;
    if (zat.Did.parse(parsed.authority()) == null or parsed.rkey() == null)
        return .invalid_id;
    if (!std.mem.eql(u8, parsed.collection() orelse return .invalid_id, list_collection))
        return .not_found;

    const configured = store orelse return .unavailable;
    const value = configured.getByUri(allocator, .{
        .uri = uri,
        .list_collection = list_collection,
        .track_collection = track_collection,
        .profile_collection = profile_collection,
        .kind = .playlist,
    }) catch |err| {
        switch (err) {
            error.CorruptProjection => std.log.err("corrupt playlist projection for {s}", .{uri}),
            error.IndexUnavailable => std.log.err("playlist index unavailable for {s}", .{uri}),
            error.OutOfMemory => {},
        }
        return switch (err) {
            error.CorruptProjection => .internal_error,
            error.IndexUnavailable, error.OutOfMemory => .unavailable,
        };
    };
    return if (value) |found| .{ .found = found } else .not_found;
}

test "playlist detail uses an environment-scoped canonical list URI" {
    const Fake = struct {
        expected_uri: []const u8,
        fn store(self: *@This()) VerifiedListStore {
            return .{ .context = self, .list_by_owner_fn = list, .get_by_uri_fn = get };
        }
        fn list(
            _: *anyopaque,
            _: std.mem.Allocator,
            _: store_module.CollectionRequest,
        ) VerifiedListStore.Error![]store_module.CollectionItem {
            return &.{};
        }
        fn get(
            context: *anyopaque,
            _: std.mem.Allocator,
            request: store_module.DetailRequest,
        ) VerifiedListStore.Error!?verified_list.Detail {
            const self: *@This() = @ptrCast(@alignCast(context));
            if (request.kind != .playlist or !std.mem.eql(u8, request.uri, self.expected_uri))
                return error.CorruptProjection;
            return null;
        }
    };
    const uri = "at://did:plc:owner/fm.plyr.dev.list/playlist";
    var id_buffer: [256]u8 = undefined;
    const id = try playlist_id.encode(&id_buffer, uri);
    var fake: Fake = .{ .expected_uri = uri };
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectEqual(
        Result.not_found,
        execute(
            arena.allocator(),
            fake.store(),
            "fm.plyr.dev.list",
            "fm.plyr.dev.track",
            "fm.plyr.dev.actor.profile",
            id,
        ),
    );
    try std.testing.expectEqual(
        Result.not_found,
        execute(
            arena.allocator(),
            fake.store(),
            "fm.plyr.list",
            "fm.plyr.track",
            "fm.plyr.actor.profile",
            id,
        ),
    );
}
