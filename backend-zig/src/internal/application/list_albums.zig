const std = @import("std");
const zat = @import("zat");
const album = @import("../domain/album.zig");
const album_list = @import("../domain/album_list.zig");
const query = @import("../http/query.zig");
const record_cursor = @import("../identity/record_cursor.zig");
const store_module = @import("../index/album_store.zig");
const AlbumStore = store_module.AlbumStore;

pub const default_limit: usize = 20;
pub const max_limit: usize = 100;
pub const cursor_prefix = "albcur_";

const Options = struct {
    limit: usize = default_limit,
    cursor: ?[]const u8 = null,
    artist_did: ?[]const u8 = null,
};

pub const Result = union(enum) {
    found: album_list.AlbumList,
    invalid_request,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?AlbumStore,
    expected_collection: []const u8,
    target: []const u8,
) Result {
    const options = parseOptions(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const artist_did = options.artist_did orelse return .invalid_request;
    if (zat.Did.parse(artist_did) == null) return .invalid_request;

    const after: ?record_cursor.Cursor = if (options.cursor) |token| blk: {
        const storage = allocator.alloc(u8, token.len) catch return .unavailable;
        const decoded = record_cursor.decode(storage, cursor_prefix, token) catch
            return .invalid_request;
        const parsed = zat.AtUri.parse(decoded.at_uri) orelse return .invalid_request;
        const collection = parsed.collection() orelse return .invalid_request;
        if (!std.mem.eql(u8, collection, expected_collection) or
            !std.mem.eql(u8, parsed.authority(), artist_did)) return .invalid_request;
        break :blk decoded;
    } else null;

    const configured_store = store orelse return .unavailable;
    const requested = options.limit + 1;
    const items = configured_store.listByArtist(allocator, .{
        .collection = expected_collection,
        .artist_did = artist_did,
        .limit = requested,
        .after = after,
    }) catch |err| return classifyStoreError(err);
    if (items.len > requested) return .internal_error;

    const has_more = items.len > options.limit;
    const visible = items[0..@min(items.len, options.limit)];
    const data = allocator.alloc(album.Album, visible.len) catch return .unavailable;
    for (visible, data) |item, *destination| destination.* = item.value;

    const next_cursor = if (has_more and visible.len > 0)
        record_cursor.encode(allocator, cursor_prefix, .{
            .created_at_us = visible[visible.len - 1].created_at_us,
            .at_uri = visible[visible.len - 1].value.record.uri,
        }) catch return .unavailable
    else
        null;

    return .{ .found = .{
        .data = data,
        .has_more = has_more,
        .next_cursor = next_cursor,
    } };
}

fn parseOptions(allocator: std.mem.Allocator, target: []const u8) !Options {
    var result: Options = .{};
    var saw_limit = false;
    var saw_cursor = false;
    var saw_artist_did = false;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "limit")) {
            if (saw_limit or pair.value.len == 0) return error.InvalidQuery;
            saw_limit = true;
            const parsed = std.fmt.parseInt(usize, pair.value, 10) catch
                return error.InvalidQuery;
            if (parsed < 1 or parsed > max_limit) return error.InvalidQuery;
            result.limit = parsed;
        } else if (std.mem.eql(u8, pair.name, "cursor")) {
            if (saw_cursor or pair.value.len == 0) return error.InvalidQuery;
            saw_cursor = true;
            result.cursor = pair.value;
        } else if (std.mem.eql(u8, pair.name, "artist_did")) {
            if (saw_artist_did or pair.value.len == 0) return error.InvalidQuery;
            saw_artist_did = true;
            result.artist_did = pair.value;
        } else return error.InvalidQuery;
    }
    return result;
}

fn classifyStoreError(err: AlbumStore.Error) Result {
    return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
}

const FakeStore = struct {
    items: []store_module.ListItem,

    fn asStore(self: *FakeStore) AlbumStore {
        return .{ .context = self, .list_by_artist_fn = listOpaque };
    }

    fn listOpaque(
        context: *anyopaque,
        _: std.mem.Allocator,
        request: store_module.ListRequest,
    ) AlbumStore.Error![]store_module.ListItem {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        if (!std.mem.eql(u8, request.collection, "fm.plyr.dev.list") or
            !std.mem.eql(u8, request.artist_did, "did:plc:artist"))
            return error.CorruptProjection;
        return self.items[0..@min(self.items.len, request.limit)];
    }
};

fn exampleAlbum(uri: []const u8, name: []const u8) album.Album {
    return .{
        .id = "alb_example",
        .record = .{
            .uri = uri,
            .cid = "bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
            .collection = "fm.plyr.dev.list",
            .rkey = "r",
        },
        .metadata = .{
            .name = name,
            .created_at = "2026-08-08T12:00:00.000000Z",
            .updated_at = "2026-08-08T12:00:00.000000Z",
        },
        .presentation = .{ .slug = "album", .description = null, .artwork_url = null },
        .artist = .{ .did = "did:plc:artist", .handle = "artist.test", .display_name = "Artist" },
        .metrics = .{ .track_count = 1, .total_plays = 2 },
        .sources = .{
            .metadata = .legacy_projection,
            .presentation = .legacy_local,
            .membership = .legacy_local,
            .metrics = .derived,
        },
        .projection = .{ .indexed_at = null, .verification = .legacy_unverified },
    };
}

test "album collection requires one valid canonical artist DID" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var fake = FakeStore{ .items = &.{} };

    try std.testing.expectEqual(
        Result.invalid_request,
        execute(arena.allocator(), fake.asStore(), "fm.plyr.dev.list", "/v1/albums"),
    );
    try std.testing.expectEqual(
        Result.invalid_request,
        execute(arena.allocator(), fake.asStore(), "fm.plyr.dev.list", "/v1/albums?artist_did=nope"),
    );
    switch (execute(
        arena.allocator(),
        fake.asStore(),
        "fm.plyr.dev.list",
        "/v1/albums?artist_did=did%3Aplc%3Aartist",
    )) {
        .found => |page| try std.testing.expectEqual(@as(usize, 0), page.data.len),
        else => return error.UnexpectedResult,
    }
}

test "album collection cursor is scoped to collection and artist" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const uri_a = "at://did:plc:artist/fm.plyr.dev.list/a";
    const uri_b = "at://did:plc:artist/fm.plyr.dev.list/b";
    var items = [_]store_module.ListItem{
        .{ .value = exampleAlbum(uri_a, "A"), .created_at_us = 200 },
        .{ .value = exampleAlbum(uri_b, "B"), .created_at_us = 100 },
    };
    var fake = FakeStore{ .items = &items };
    const result = execute(
        arena.allocator(),
        fake.asStore(),
        "fm.plyr.dev.list",
        "/v1/albums?artist_did=did:plc:artist&limit=1",
    );
    const page = result.found;
    try std.testing.expect(page.has_more);
    const storage = try arena.allocator().alloc(u8, page.next_cursor.?.len);
    const decoded = try record_cursor.decode(storage, cursor_prefix, page.next_cursor.?);
    try std.testing.expectEqualStrings(uri_a, decoded.at_uri);

    const foreign = try record_cursor.encode(arena.allocator(), cursor_prefix, .{
        .created_at_us = 100,
        .at_uri = "at://did:plc:other/fm.plyr.dev.list/x",
    });
    const target = try std.fmt.allocPrint(
        arena.allocator(),
        "/v1/albums?artist_did=did:plc:artist&cursor={s}",
        .{foreign},
    );
    try std.testing.expectEqual(
        Result.invalid_request,
        execute(arena.allocator(), fake.asStore(), "fm.plyr.dev.list", target),
    );
}
