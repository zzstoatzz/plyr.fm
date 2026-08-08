const std = @import("std");
const zat = @import("zat");
const album_detail = @import("../domain/album_detail.zig");
const album_id = @import("../identity/album_id.zig");
const store_module = @import("../index/album_detail_store.zig");
const AlbumDetailStore = store_module.AlbumDetailStore;

pub const Result = union(enum) {
    found: album_detail.AlbumDetail,
    invalid_id,
    not_found,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?AlbumDetailStore,
    list_collection: []const u8,
    track_collection: []const u8,
    id: []const u8,
) Result {
    const decoded = allocator.alloc(u8, id.len) catch return .unavailable;
    const uri = album_id.decode(decoded, id) catch return .invalid_id;
    const parsed = zat.AtUri.parse(uri) orelse return .invalid_id;
    const collection = parsed.collection() orelse return .invalid_id;
    if (zat.Did.parse(parsed.authority()) == null or parsed.rkey() == null)
        return .invalid_id;
    if (!std.mem.eql(u8, collection, list_collection)) return .not_found;

    const configured = store orelse return .unavailable;
    const value = configured.getByUri(allocator, .{
        .uri = uri,
        .list_collection = list_collection,
        .track_collection = track_collection,
    }) catch |err| {
        switch (err) {
            error.CorruptProjection => std.log.err("corrupt album projection for {s}", .{uri}),
            error.IndexUnavailable => std.log.err("album index unavailable for {s}", .{uri}),
            error.OutOfMemory => {},
        }
        return switch (err) {
            error.CorruptProjection => .internal_error,
            error.IndexUnavailable, error.OutOfMemory => .unavailable,
        };
    };
    return if (value) |found| .{ .found = found } else .not_found;
}

test "album detail uses an opaque environment-scoped canonical URI" {
    const Fake = struct {
        expected_uri: []const u8,

        fn store(self: *@This()) AlbumDetailStore {
            return .{ .context = self, .get_by_uri_fn = get };
        }

        fn get(
            context: *anyopaque,
            _: std.mem.Allocator,
            request: store_module.Request,
        ) AlbumDetailStore.Error!?album_detail.AlbumDetail {
            const self: *@This() = @ptrCast(@alignCast(context));
            if (!std.mem.eql(u8, request.uri, self.expected_uri))
                return error.CorruptProjection;
            return null;
        }
    };
    const uri = "at://did:plc:artist/fm.plyr.dev.list/album";
    var buffer: [256]u8 = undefined;
    const id = try album_id.encode(&buffer, uri);
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
            id,
        ),
    );
    try std.testing.expectEqual(
        Result.invalid_id,
        execute(arena.allocator(), fake.store(), "fm.plyr.dev.list", "fm.plyr.dev.track", "album"),
    );
    try std.testing.expectEqual(
        Result.not_found,
        execute(arena.allocator(), fake.store(), "fm.plyr.list", "fm.plyr.track", id),
    );
    var invalid_buffer: [256]u8 = undefined;
    const invalid_authority = try album_id.encode(
        &invalid_buffer,
        "at://not-a-did/fm.plyr.dev.list/album",
    );
    try std.testing.expectEqual(
        Result.invalid_id,
        execute(
            arena.allocator(),
            fake.store(),
            "fm.plyr.dev.list",
            "fm.plyr.dev.track",
            invalid_authority,
        ),
    );
}
