const std = @import("std");
const zat = @import("zat");
const track = @import("../domain/track.zig");
const track_list = @import("../domain/track_list.zig");
const track_cursor = @import("../identity/track_cursor.zig");
const store_module = @import("../index/track_store.zig");
const TrackStore = store_module.TrackStore;

pub const default_limit: usize = 50;
pub const max_limit: usize = 100;

const Options = struct {
    limit: usize = default_limit,
    cursor: ?[]const u8 = null,
};

pub const Result = union(enum) {
    found: track_list.TrackList,
    invalid_request,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?TrackStore,
    expected_collection: []const u8,
    target: []const u8,
) Result {
    const options = parseOptions(target) catch return .invalid_request;
    const after: ?track_cursor.Cursor = if (options.cursor) |token| blk: {
        const storage = allocator.alloc(u8, token.len) catch return .unavailable;
        const decoded = track_cursor.decode(storage, token) catch return .invalid_request;
        const parsed = zat.AtUri.parse(decoded.at_uri) orelse return .invalid_request;
        const collection = parsed.collection() orelse return .invalid_request;
        if (!std.mem.eql(u8, collection, expected_collection)) return .invalid_request;
        break :blk decoded;
    } else null;

    const configured_store = store orelse return .unavailable;
    const requested = options.limit + 1;
    const items = configured_store.listDiscovery(allocator, .{
        .collection = expected_collection,
        .limit = requested,
        .after = after,
    }) catch |err| return classifyStoreError(err);
    if (items.len > requested) return .internal_error;

    const has_more = items.len > options.limit;
    const visible = items[0..@min(items.len, options.limit)];
    const data = allocator.alloc(track.Track, visible.len) catch return .unavailable;
    for (visible, data) |item, *destination| destination.* = item.value;

    const next_cursor = if (has_more and visible.len > 0)
        track_cursor.encode(allocator, .{
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

fn parseOptions(target: []const u8) !Options {
    const query_start = std.mem.indexOfScalar(u8, target, '?') orelse return .{};
    const query = target[query_start + 1 ..];
    if (query.len == 0) return .{};

    var result: Options = .{};
    var saw_limit = false;
    var saw_cursor = false;
    var pairs = std.mem.splitScalar(u8, query, '&');
    while (pairs.next()) |pair| {
        if (pair.len == 0) return error.InvalidQuery;
        const separator = std.mem.indexOfScalar(u8, pair, '=') orelse return error.InvalidQuery;
        const name = pair[0..separator];
        const value = pair[separator + 1 ..];
        if (std.mem.eql(u8, name, "limit")) {
            if (saw_limit or value.len == 0) return error.InvalidQuery;
            saw_limit = true;
            const parsed = std.fmt.parseInt(usize, value, 10) catch return error.InvalidQuery;
            if (parsed < 1 or parsed > max_limit) return error.InvalidQuery;
            result.limit = parsed;
        } else if (std.mem.eql(u8, name, "cursor")) {
            if (saw_cursor or value.len == 0) return error.InvalidQuery;
            saw_cursor = true;
            result.cursor = value;
        } else {
            return error.InvalidQuery;
        }
    }
    return result;
}

fn classifyStoreError(err: TrackStore.Error) Result {
    return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
}

const FakeStore = struct {
    items: []store_module.ListItem,
    expected_collection: []const u8,

    fn asStore(self: *FakeStore) TrackStore {
        return .{
            .context = self,
            .get_by_uri_fn = getOpaque,
            .list_discovery_fn = listOpaque,
            .ready_fn = readyOpaque,
        };
    }

    fn readyOpaque(_: *anyopaque) bool {
        return true;
    }

    fn getOpaque(_: *anyopaque, _: std.mem.Allocator, _: []const u8) TrackStore.Error!?track.Track {
        return null;
    }

    fn listOpaque(
        context: *anyopaque,
        _: std.mem.Allocator,
        request: store_module.ListRequest,
    ) TrackStore.Error![]store_module.ListItem {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        if (!std.mem.eql(u8, request.collection, self.expected_collection)) return error.CorruptProjection;
        return self.items[0..@min(self.items.len, request.limit)];
    }
};

fn exampleTrack(uri: []const u8, title: []const u8) track.Track {
    return .{
        .id = "trk_example",
        .record = .{
            .uri = uri,
            .cid = null,
            .revision = null,
            .collection = "fm.plyr.dev.track",
            .rkey = "r",
        },
        .metadata = .{
            .title = title,
            .description = null,
            .album = null,
            .duration_seconds = null,
            .created_at = "2026-08-08T12:00:00.000000Z",
        },
        .artist = .{
            .did = "did:plc:artist",
            .profile = .{ .handle = "artist.test", .display_name = "Artist", .avatar_url = null },
        },
        .media = .{ .artifacts = &.{}, .origins = &.{} },
        .access = .{ .visibility = .public, .in_discovery = true, .gate = null, .space_uri = null },
        .moderation = .{ .self_labels = &.{}, .operator_labels = &.{}, .override = null },
        .metrics = .{ .play_count = 0 },
        .projection = .{ .indexed_at = null, .verification = .legacy_unverified },
    };
}

test "collection options are strict and bounded" {
    try std.testing.expectEqual(default_limit, (try parseOptions("/v1/tracks")).limit);
    try std.testing.expectEqual(@as(usize, 100), (try parseOptions("/v1/tracks?limit=100")).limit);
    try std.testing.expectError(error.InvalidQuery, parseOptions("/v1/tracks?limit=0"));
    try std.testing.expectError(error.InvalidQuery, parseOptions("/v1/tracks?limit=101"));
    try std.testing.expectError(error.InvalidQuery, parseOptions("/v1/tracks?limit=2&limit=3"));
    try std.testing.expectError(error.InvalidQuery, parseOptions("/v1/tracks?offset=10"));
}

test "collection returns one page and a cursor from the last visible row" {
    const uri_a = "at://did:plc:artist/fm.plyr.dev.track/a";
    const uri_b = "at://did:plc:artist/fm.plyr.dev.track/b";
    const uri_c = "at://did:plc:artist/fm.plyr.dev.track/c";
    var items = [_]store_module.ListItem{
        .{ .value = exampleTrack(uri_a, "A"), .created_at_us = 300 },
        .{ .value = exampleTrack(uri_b, "B"), .created_at_us = 200 },
        .{ .value = exampleTrack(uri_c, "C"), .created_at_us = 100 },
    };
    var fake = FakeStore{ .items = &items, .expected_collection = "fm.plyr.dev.track" };
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    const result = execute(
        arena.allocator(),
        fake.asStore(),
        "fm.plyr.dev.track",
        "/v1/tracks?limit=2",
    );
    const page = result.found;
    try std.testing.expectEqual(@as(usize, 2), page.data.len);
    try std.testing.expect(page.has_more);
    try std.testing.expect(page.next_cursor != null);

    const storage = try arena.allocator().alloc(u8, page.next_cursor.?.len);
    const decoded = try track_cursor.decode(storage, page.next_cursor.?);
    try std.testing.expectEqual(@as(i64, 200), decoded.created_at_us);
    try std.testing.expectEqualStrings(uri_b, decoded.at_uri);

    const json = try std.json.Stringify.valueAlloc(arena.allocator(), page, .{});
    const parsed = try std.json.parseFromSliceLeaky(std.json.Value, arena.allocator(), json, .{});
    try std.testing.expectEqualStrings("list", parsed.object.get("object").?.string);
    try std.testing.expectEqual(@as(usize, 2), parsed.object.get("data").?.array.items.len);
    try std.testing.expect(parsed.object.get("has_more").?.bool);
    try std.testing.expect(parsed.object.get("next_cursor") != null);
}
