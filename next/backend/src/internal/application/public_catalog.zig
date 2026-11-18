//! fm.plyr.getTopTracks and fm.plyr.getLatestTracks: the public charts as
//! XRPC queries, so other atproto apps can show and play them. Each track is
//! its verified record as the artist wrote it, plus the counts plyr derives.

const std = @import("std");
const track = @import("../domain/track.zig");
const query = @import("../http/query.zig");
const list_track_chart = @import("list_track_chart.zig");
const list_tracks = @import("list_tracks.zig");
const track_chart = @import("../domain/track_chart.zig");
const TrackChartStore = @import("../index/track_chart_store.zig").TrackChartStore;
const TrackStore = @import("../index/track_store.zig").TrackStore;
const record_json = @import("../index/track_record_json_store.zig");

pub const top_default_limit: usize = 10;
pub const latest_default_limit: usize = 20;
pub const max_limit: usize = 50;
pub const max_cursor_bytes: usize = 512;

pub const Collections = struct {
    track: []const u8,
    profile: []const u8,
    like: []const u8,
};

pub const Result = union(enum) {
    /// the response body, already JSON
    found: []const u8,
    invalid_request,
    internal_error,
    unavailable,
};

pub fn topTracks(
    allocator: std.mem.Allocator,
    chart_store: ?TrackChartStore,
    records: ?record_json.Store,
    collections: Collections,
    target: []const u8,
    now_us: i64,
) Result {
    const options = parseTop(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const chart = switch (list_track_chart.executeOptions(
        allocator,
        chart_store,
        collections.track,
        collections.profile,
        collections.like,
        options,
        now_us,
    )) {
        .found => |value| value,
        .invalid_request => return .invalid_request,
        .internal_error => return .internal_error,
        .unavailable => return .unavailable,
    };
    const tracks = allocator.alloc(track.Track, chart.data.len) catch return .unavailable;
    for (chart.data, tracks) |entry, *destination| destination.* = entry.track;
    return render(allocator, records, tracks, null);
}

pub fn latestTracks(
    allocator: std.mem.Allocator,
    track_store: ?TrackStore,
    records: ?record_json.Store,
    track_collection: []const u8,
    target: []const u8,
) Result {
    const options = parseLatest(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const page = switch (list_tracks.executeOptions(allocator, track_store, track_collection, options)) {
        .found => |value| value,
        .invalid_request => return .invalid_request,
        .internal_error => return .internal_error,
        .unavailable => return .unavailable,
    };
    if (page.next_cursor) |cursor| if (cursor.len > max_cursor_bytes) return .internal_error;
    return render(allocator, records, page.data, page.next_cursor);
}

/// XRPC servers ignore parameters they do not define; defined ones are strict.
fn parseTop(allocator: std.mem.Allocator, target: []const u8) !list_track_chart.Options {
    var options: list_track_chart.Options = .{ .limit = top_default_limit };
    var saw_limit = false;
    var saw_period = false;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "limit")) {
            if (saw_limit) return error.InvalidQuery;
            saw_limit = true;
            options.limit = try parseLimit(pair.value);
        } else if (std.mem.eql(u8, pair.name, "period")) {
            if (saw_period) return error.InvalidQuery;
            saw_period = true;
            options.period = std.meta.stringToEnum(track_chart.Period, pair.value) orelse
                return error.InvalidQuery;
        }
    }
    return options;
}

fn parseLatest(allocator: std.mem.Allocator, target: []const u8) !list_tracks.Options {
    var options: list_tracks.Options = .{ .limit = latest_default_limit };
    var saw_limit = false;
    var saw_cursor = false;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "limit")) {
            if (saw_limit) return error.InvalidQuery;
            saw_limit = true;
            options.limit = try parseLimit(pair.value);
        } else if (std.mem.eql(u8, pair.name, "cursor")) {
            if (saw_cursor or pair.value.len == 0 or pair.value.len > max_cursor_bytes) return error.InvalidQuery;
            saw_cursor = true;
            options.cursor = pair.value;
        }
    }
    return options;
}

fn parseLimit(text: []const u8) !usize {
    if (text.len == 0) return error.InvalidQuery;
    const limit = query.parseDecimal(usize, text) catch return error.InvalidQuery;
    if (limit < 1 or limit > max_limit) return error.InvalidQuery;
    return limit;
}

/// artistView caps displayName at 640 bytes; past that, leave it out.
fn displayName(value: []const u8) ?[]const u8 {
    if (value.len == 0 or value.len > 640) return null;
    return value;
}

const ArtistView = struct {
    did: []const u8,
    handle: []const u8,
    displayName: ?[]const u8 = null,
    avatar: ?[]const u8 = null,
};

fn render(
    allocator: std.mem.Allocator,
    records: ?record_json.Store,
    tracks: []const track.Track,
    cursor: ?[]const u8,
) Result {
    const store = records orelse return .unavailable;
    const uris = allocator.alloc([]const u8, tracks.len) catch return .unavailable;
    for (tracks, uris) |item, *uri| uri.* = item.record.uri;
    const found = store.lookup(allocator, uris) catch return .unavailable;
    const body = write(allocator, found, tracks, cursor) catch return .unavailable;
    return .{ .found = body };
}

fn write(
    allocator: std.mem.Allocator,
    found: []const record_json.Entry,
    tracks: []const track.Track,
    cursor: ?[]const u8,
) error{ OutOfMemory, WriteFailed }![]const u8 {
    const options: std.json.Stringify.Options = .{ .emit_null_optional_fields = false };
    var out: std.Io.Writer.Allocating = .init(allocator);
    const w = &out.writer;
    try w.writeAll("{");
    if (cursor) |value| {
        try w.writeAll("\"cursor\":");
        try std.json.Stringify.value(value, options, w);
        try w.writeAll(",");
    }
    try w.writeAll("\"tracks\":[");
    var written: usize = 0;
    for (tracks) |item| {
        const cid = item.record.cid orelse continue;
        // a track whose record we do not hold at this cid is left out rather
        // than sent with a record that does not match it
        const json = for (found) |entry| {
            if (std.mem.eql(u8, entry.uri, item.record.uri) and std.mem.eql(u8, entry.cid, cid)) break entry.json;
        } else continue;
        if (written != 0) try w.writeAll(",");
        written += 1;
        try w.writeAll("{\"uri\":");
        try std.json.Stringify.value(item.record.uri, options, w);
        try w.writeAll(",\"cid\":");
        try std.json.Stringify.value(cid, options, w);
        try w.writeAll(",\"artist\":");
        try std.json.Stringify.value(ArtistView{
            .did = item.artist.did,
            .handle = item.artist.profile.handle,
            .displayName = displayName(item.artist.profile.display_name),
            .avatar = item.artist.profile.avatar_url,
        }, options, w);
        try w.writeAll(",\"record\":");
        try w.writeAll(json);
        try w.print(",\"likeCount\":{d},\"playCount\":{d},\"indexedAt\":", .{
            @max(item.metrics.like_count, 0),
            @max(item.metrics.play_count, 0),
        });
        try std.json.Stringify.value(item.projection.indexed_at orelse item.metadata.created_at, options, w);
        try w.writeAll("}");
    }
    try w.writeAll("]}");
    return out.written();
}

test "catalog parameters follow the lexicon and ignore unknown ones" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const a = arena_state.allocator();

    const top = try parseTop(a, "/xrpc/fm.plyr.getTopTracks");
    try std.testing.expectEqual(top_default_limit, top.limit);
    try std.testing.expectEqual(track_chart.Period.all_time, top.period);
    const week = try parseTop(a, "/xrpc/fm.plyr.getTopTracks?period=week&limit=50&extra=1");
    try std.testing.expectEqual(track_chart.Period.week, week.period);
    try std.testing.expectEqual(@as(usize, 50), week.limit);
    try std.testing.expectError(error.InvalidQuery, parseTop(a, "/xrpc/fm.plyr.getTopTracks?period=year"));
    try std.testing.expectError(error.InvalidQuery, parseTop(a, "/xrpc/fm.plyr.getTopTracks?limit=51"));
    try std.testing.expectError(error.InvalidQuery, parseTop(a, "/xrpc/fm.plyr.getTopTracks?limit=0"));

    const latest = try parseLatest(a, "/xrpc/fm.plyr.getLatestTracks");
    try std.testing.expectEqual(latest_default_limit, latest.limit);
    try std.testing.expect(latest.cursor == null);
    const paged = try parseLatest(a, "/xrpc/fm.plyr.getLatestTracks?limit=5&cursor=abc");
    try std.testing.expectEqual(@as(usize, 5), paged.limit);
    try std.testing.expectEqualStrings("abc", paged.cursor.?);
    try std.testing.expectError(error.InvalidQuery, parseLatest(a, "/xrpc/fm.plyr.getLatestTracks?cursor="));
    try std.testing.expectError(error.InvalidQuery, parseLatest(a, "/xrpc/fm.plyr.getLatestTracks?limit=100"));
}

test "track views carry the stored record and leave out tracks without one" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const a = arena_state.allocator();
    const tracks = [_]track.Track{
        testTrack("at://did:plc:artist/fm.plyr.track/one", "bafyone", "Artist"),
        testTrack("at://did:plc:artist/fm.plyr.track/two", "bafytwo", ""),
        testTrack("at://did:plc:artist/fm.plyr.track/three", "bafythree", "Artist"),
    };
    const found = [_]record_json.Entry{
        .{ .uri = "at://did:plc:artist/fm.plyr.track/one", .cid = "bafyone", .json = "{\"title\": \"one\"}" },
        .{ .uri = "at://did:plc:artist/fm.plyr.track/two", .cid = "bafytwo", .json = "{\"title\": \"two\"}" },
        // projected at an older cid than the composed row: not served
        .{ .uri = "at://did:plc:artist/fm.plyr.track/three", .cid = "bafyold", .json = "{\"title\": \"old\"}" },
    };
    const body = try write(a, &found, &tracks, "next");
    const parsed = try std.json.parseFromSliceLeaky(std.json.Value, a, body, .{});
    try std.testing.expectEqualStrings("next", parsed.object.get("cursor").?.string);
    const items = parsed.object.get("tracks").?.array.items;
    try std.testing.expectEqual(@as(usize, 2), items.len);
    try std.testing.expectEqualStrings("bafyone", items[0].object.get("cid").?.string);
    try std.testing.expectEqualStrings("one", items[0].object.get("record").?.object.get("title").?.string);
    try std.testing.expectEqualStrings("Artist", items[0].object.get("artist").?.object.get("displayName").?.string);
    try std.testing.expect(items[1].object.get("artist").?.object.get("displayName") == null);
    try std.testing.expect(items[1].object.get("artist").?.object.get("avatar") == null);
    try std.testing.expectEqual(@as(i64, 3), items[0].object.get("likeCount").?.integer);
    try std.testing.expectEqual(@as(i64, 7), items[0].object.get("playCount").?.integer);
    try std.testing.expectEqualStrings("2026-11-18T00:00:00.000000Z", items[0].object.get("indexedAt").?.string);

    const empty = try write(a, &.{}, &.{}, null);
    try std.testing.expectEqualStrings("{\"tracks\":[]}", empty);
}

fn testTrack(uri: []const u8, cid: []const u8, display_name: []const u8) track.Track {
    return .{
        .id = uri,
        .record = .{ .uri = uri, .cid = cid, .revision = null, .collection = "fm.plyr.track", .rkey = "one" },
        .metadata = .{
            .title = "one",
            .description = null,
            .album = null,
            .duration_seconds = null,
            .created_at = "2026-11-17T00:00:00Z",
        },
        .artist = .{ .did = "did:plc:artist", .profile = .{
            .handle = "artist.example",
            .display_name = display_name,
            .avatar_url = null,
        } },
        .media = .{ .artifacts = &.{}, .origins = &.{} },
        .access = .{ .visibility = .public, .in_discovery = true, .gate = null, .space_uri = null },
        .moderation = .{ .self_labels = &.{}, .operator_labels = &.{}, .override = null },
        .metrics = .{ .play_count = 7, .like_count = 3 },
        .projection = .{ .indexed_at = "2026-11-18T00:00:00.000000Z", .verification = .verified_repo },
    };
}
