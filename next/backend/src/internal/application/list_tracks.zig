const std = @import("std");
const tag_filter = @import("../domain/tag_filter.zig");
const zat = @import("zat");
const track = @import("../domain/track.zig");
const track_list = @import("../domain/track_list.zig");
const track_cursor = @import("../identity/track_cursor.zig");
const query = @import("../http/query.zig");
const store_module = @import("../index/track_store.zig");
const TrackStore = store_module.TrackStore;

pub const default_limit: usize = 50;
pub const max_limit: usize = 100;
pub const max_tag_filter_bytes: usize = 200;

const Options = struct {
    limit: usize = default_limit,
    cursor: ?[]const u8 = null,
    artist_did: ?[]const u8 = null,
    tags: []const []const u8 = &.{},
    hidden_tags: []const []const u8 = tag_filter.defaults,
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
    const options = parseOptions(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const cursor_prefix = filterPrefix(allocator, options, expected_collection) catch return .unavailable;
    const after: ?track_cursor.Cursor = if (options.cursor) |token| blk: {
        if (!std.mem.startsWith(u8, token, cursor_prefix)) return .invalid_request;
        const raw = token[cursor_prefix.len..];
        const storage = allocator.alloc(u8, raw.len) catch return .unavailable;
        const decoded = track_cursor.decode(storage, raw) catch return .invalid_request;
        const parsed = zat.AtUri.parse(decoded.at_uri) orelse return .invalid_request;
        const collection = parsed.collection() orelse return .invalid_request;
        if (!std.mem.eql(u8, collection, expected_collection)) return .invalid_request;
        break :blk decoded;
    } else null;

    const scope: store_module.ListScope = if (options.artist_did) |did| blk: {
        if (zat.Did.parse(did) == null) return .invalid_request;
        break :blk .{ .artist = did };
    } else .discovery;
    const configured_store = store orelse return .unavailable;
    const requested = options.limit + 1;
    const items = configured_store.listPublic(allocator, .{
        .collection = expected_collection,
        .scope = scope,
        .limit = requested,
        .after = after,
        .tags = options.tags,
        .hidden_tags = options.hidden_tags,
    }) catch |err| return classifyStoreError(err);
    if (items.len > requested) return .internal_error;

    const has_more = items.len > options.limit;
    const visible = items[0..@min(items.len, options.limit)];
    const data = allocator.alloc(track.Track, visible.len) catch return .unavailable;
    for (visible, data) |item, *destination| destination.* = item.value;

    const next_cursor = if (has_more and visible.len > 0)
        encodeCursor(allocator, cursor_prefix, .{
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
    var tags: std.ArrayList([]const u8) = .empty;
    var hidden: std.ArrayList([]const u8) = .empty;
    var saw_hidden = false;
    var empty_hidden = false;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "limit")) {
            const value = pair.value;
            if (saw_limit or value.len == 0) return error.InvalidQuery;
            saw_limit = true;
            const parsed = query.parseDecimal(usize, value) catch return error.InvalidQuery;
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
        } else if (std.mem.eql(u8, pair.name, "tag")) {
            if (pair.value.len == 0 or pair.value.len > max_tag_filter_bytes or std.mem.indexOfScalar(u8, pair.value, 0) != null or !std.unicode.utf8ValidateSlice(pair.value)) return error.InvalidQuery;
            const normalized = try tag_filter.normalize(allocator, pair.value);
            if (normalized.len == 0) return error.InvalidQuery;
            var seen = false;
            for (tags.items) |existing| if (std.mem.eql(u8, existing, normalized)) {
                seen = true;
                break;
            };
            if (!seen) try tags.append(allocator, normalized);
            if (tags.items.len > 10) return error.InvalidQuery;
        } else if (std.mem.eql(u8, pair.name, "hidden_tag")) {
            if (pair.value.len == 0) {
                if (saw_hidden) return error.InvalidQuery;
                empty_hidden = true;
            } else {
                if (empty_hidden) return error.InvalidQuery;
                try hidden.append(allocator, pair.value);
            }
            saw_hidden = true;
        } else {
            return error.InvalidQuery;
        }
    }
    if (saw_hidden) result.hidden_tags = try tag_filter.canonical(allocator, hidden.items);
    std.mem.sort([]const u8, tags.items, {}, struct {
        fn less(_: void, a: []const u8, b: []const u8) bool {
            return std.mem.lessThan(u8, a, b);
        }
    }.less);
    result.tags = try tags.toOwnedSlice(allocator);
    return result;
}

fn filterPrefix(allocator: std.mem.Allocator, options: Options, collection: []const u8) ![]const u8 {
    const encoded = try std.json.Stringify.valueAlloc(allocator, .{ collection, options.artist_did, options.tags, if (options.artist_did == null) options.hidden_tags else &.{} }, .{});
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(encoded, &digest, .{});
    return std.fmt.allocPrint(allocator, "trkfilter_{s}_", .{std.fmt.bytesToHex(digest, .lower)});
}

fn encodeCursor(allocator: std.mem.Allocator, prefix: []const u8, cursor: track_cursor.Cursor) ![]const u8 {
    const encoded = try track_cursor.encode(allocator, cursor);
    return std.fmt.allocPrint(allocator, "{s}{s}", .{ prefix, encoded });
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
            .list_public_fn = listOpaque,
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
        switch (request.scope) {
            .discovery => {},
            .artist => |did| if (!std.mem.eql(u8, did, "did:plc:artist")) return error.CorruptProjection,
        }
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
    const allocator = std.testing.allocator;
    try std.testing.expectEqual(default_limit, (try parseOptions(allocator, "/v1/tracks")).limit);
    try std.testing.expectEqual(@as(usize, 100), (try parseOptions(allocator, "/v1/tracks?limit=100")).limit);
    try std.testing.expectError(error.InvalidQuery, parseOptions(allocator, "/v1/tracks?limit=0"));
    try std.testing.expectError(error.InvalidQuery, parseOptions(allocator, "/v1/tracks?limit=101"));
    try std.testing.expectError(error.InvalidQuery, parseOptions(allocator, "/v1/tracks?limit=2&limit=3"));
    try std.testing.expectError(error.InvalidQuery, parseOptions(allocator, "/v1/tracks?offset=10"));
    try std.testing.expectError(error.InvalidQuery, parseOptions(allocator, "/v1/tracks?limit=1_0"));
}

test "artist filters accept raw and percent-encoded DIDs only once" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    try std.testing.expectEqualStrings(
        "did:plc:artist",
        (try parseOptions(allocator, "/v1/tracks?artist_did=did:plc:artist")).artist_did.?,
    );
    try std.testing.expectEqualStrings(
        "did:plc:artist",
        (try parseOptions(allocator, "/v1/tracks?artist_did=did%3Aplc%3Aartist")).artist_did.?,
    );
    try std.testing.expectError(
        error.InvalidQuery,
        parseOptions(allocator, "/v1/tracks?artist_did=did:plc:a&artist_did=did:plc:b"),
    );
    try std.testing.expectError(
        error.InvalidQuery,
        parseOptions(allocator, "/v1/tracks?artist_did=did%3Xplc"),
    );
    try std.testing.expectError(error.InvalidQuery, parseOptions(allocator, "/v1/tracks?limit=%2B5"));
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
    const prefix = try filterPrefix(arena.allocator(), .{}, "fm.plyr.dev.track");
    const decoded = try track_cursor.decode(storage, page.next_cursor.?[prefix.len..]);
    try std.testing.expectEqual(@as(i64, 200), decoded.created_at_us);
    try std.testing.expectEqualStrings(uri_b, decoded.at_uri);

    const json = try std.json.Stringify.valueAlloc(arena.allocator(), page, .{});
    const parsed = try std.json.parseFromSliceLeaky(std.json.Value, arena.allocator(), json, .{});
    try std.testing.expectEqualStrings("list", parsed.object.get("object").?.string);
    try std.testing.expectEqual(@as(usize, 2), parsed.object.get("data").?.array.items.len);
    try std.testing.expect(parsed.object.get("has_more").?.bool);
    try std.testing.expect(parsed.object.get("next_cursor") != null);
}

test "collection passes a validated artist scope to the index" {
    var fake = FakeStore{ .items = &.{}, .expected_collection = "fm.plyr.dev.track" };
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    switch (execute(
        arena.allocator(),
        fake.asStore(),
        "fm.plyr.dev.track",
        "/v1/tracks?artist_did=did%3Aplc%3Aartist",
    )) {
        .found => |page| try std.testing.expectEqual(@as(usize, 0), page.data.len),
        else => return error.UnexpectedResult,
    }
    try std.testing.expectEqual(
        Result.invalid_request,
        execute(
            arena.allocator(),
            fake.asStore(),
            "fm.plyr.dev.track",
            "/v1/tracks?artist_did=not-a-did",
        ),
    );
}

test "tag selections are bounded normalized sets and cursors bind their filters" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const options = try parseOptions(a, "/v1/tracks?tag=Hip-Hop&tag=ambient&tag=HIP-HOP");
    try std.testing.expectEqual(@as(usize, 2), options.tags.len);
    try std.testing.expectEqualStrings("ambient", options.tags[0]);
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/tracks?tag="));
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/tracks?tag=bad%00tag"));
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/tracks?tag=1&tag=2&tag=3&tag=4&tag=5&tag=6&tag=7&tag=8&tag=9&tag=10&tag=11"));
    var items = [_]store_module.ListItem{
        .{ .value = exampleTrack("at://did:plc:artist/fm.plyr.dev.track/a", "A"), .created_at_us = 300 },
        .{ .value = exampleTrack("at://did:plc:artist/fm.plyr.dev.track/b", "B"), .created_at_us = 200 },
    };
    var fake = FakeStore{ .items = &items, .expected_collection = "fm.plyr.dev.track" };
    const result = execute(a, fake.asStore(), "fm.plyr.dev.track", "/v1/tracks?tag=ambient&tag=hip-hop&limit=1");
    const cursor = result.found.next_cursor.?;
    const same = try std.fmt.allocPrint(a, "/v1/tracks?tag=HIP-HOP&tag=ambient&cursor={s}", .{cursor});
    try std.testing.expect(execute(a, fake.asStore(), "fm.plyr.dev.track", same) == .found);
    const changed = try std.fmt.allocPrint(a, "/v1/tracks?tag=ambient&cursor={s}", .{cursor});
    try std.testing.expectEqual(Result.invalid_request, execute(a, fake.asStore(), "fm.plyr.dev.track", changed));
    const artist_changed = try std.fmt.allocPrint(a, "/v1/tracks?tag=ambient&tag=hip-hop&artist_did=did:plc:artist&cursor={s}", .{cursor});
    try std.testing.expectEqual(Result.invalid_request, execute(a, fake.asStore(), "fm.plyr.dev.track", artist_changed));
}

test "derived tag names normalize idempotently within their filter bound" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    for ([_][]const u8{ " - ambient - ", "-- - AMBIENT - --", "\t- a\t b -\r\n", "---", "hip-hop" }) |value| {
        const once = try tag_filter.normalize(a, value);
        try std.testing.expectEqualStrings(once, try tag_filter.normalize(a, once));
    }
    try std.testing.expectEqualStrings("ambient", try tag_filter.normalize(a, " - ambient - "));
    var expanded: std.ArrayList(u8) = .empty;
    for (0..25) |_| try expanded.appendSlice(a, "ⱥ");
    const selected = try parseOptions(a, try std.fmt.allocPrint(a, "/v1/tracks?tag={s}", .{expanded.items}));
    try std.testing.expectEqualStrings(expanded.items, selected.tags[0]);
    var boundary: [200]u8 = undefined;
    @memset(&boundary, 'a');
    const accepted = try std.fmt.allocPrint(a, "/v1/tracks?tag={s}", .{boundary});
    _ = try parseOptions(a, accepted);
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, try std.fmt.allocPrint(a, "{s}a", .{accepted})));
}

test "discovery hidden tags default normalize and bind cursors" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const defaults = try parseOptions(a, "/v1/tracks");
    try std.testing.expectEqual(@as(usize, 3), defaults.hidden_tags.len);
    const none = try parseOptions(a, "/v1/tracks?hidden_tag=");
    try std.testing.expectEqual(@as(usize, 0), none.hidden_tags.len);
    const custom = try parseOptions(a, "/v1/tracks?hidden_tag=SUNO&hidden_tag=ai&hidden_tag=ai");
    try std.testing.expectEqual(@as(usize, 2), custom.hidden_tags.len);
    try std.testing.expectEqualStrings("ai", custom.hidden_tags[0]);
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/tracks?hidden_tag=&hidden_tag=ai"));
    try std.testing.expect(!std.mem.eql(u8, try filterPrefix(a, defaults, "fm.plyr.track"), try filterPrefix(a, none, "fm.plyr.track")));
}
