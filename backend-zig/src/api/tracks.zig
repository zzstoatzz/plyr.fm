const std = @import("std");
const get_track = @import("../internal/application/get_track.zig");
const get_playback = @import("../internal/application/get_playback.zig");
const list_tracks = @import("../internal/application/list_tracks.zig");
const record_play = @import("../internal/application/record_play.zig");
const PlaybackStore = @import("../internal/index/playback_store.zig").PlaybackStore;
const TrackStore = @import("../internal/index/track_store.zig").TrackStore;
const PlayDedupStore = @import("../internal/metrics/play_dedup_store.zig").PlayDedupStore;
const PlayMetricStore = @import("../internal/metrics/play_metric_store.zig").PlayMetricStore;
const query = @import("../internal/http/query.zig");
const response = @import("response.zig");

pub fn list(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?TrackStore,
    collection: []const u8,
    cors: response.CorsPolicy,
    request_id: []const u8,
) !void {
    switch (list_tracks.execute(allocator, store, collection, request.head.target)) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_request => try response.apiError(request, .invalid_request, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}

pub fn get(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?TrackStore,
    collection: []const u8,
    cors: response.CorsPolicy,
    id: []const u8,
    request_id: []const u8,
) !void {
    switch (get_track.execute(allocator, store, collection, id)) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_id => try response.apiError(request, .invalid_request, request_id, cors),
        .not_found => try response.apiError(request, .not_found, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}

pub fn playback(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    store: ?PlaybackStore,
    collection: []const u8,
    cors: response.CorsPolicy,
    id: []const u8,
    request_id: []const u8,
) !void {
    switch (get_playback.execute(allocator, store, collection, id)) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .authentication_required => try response.apiError(request, .authentication_required, request_id, cors),
        .invalid_id => try response.apiError(request, .invalid_request, request_id, cors),
        .not_found => try response.apiError(request, .not_found, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}

pub fn recordPlay(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    metric_store: ?PlayMetricStore,
    dedup_store: ?PlayDedupStore,
    collection: []const u8,
    cors: response.CorsPolicy,
    io: std.Io,
    id: []const u8,
    request_id: []const u8,
) !void {
    const ref_code = parsePlayQuery(allocator, request.head.target) catch {
        try response.apiError(request, .invalid_request, request_id, cors);
        return;
    };
    const identity = listenerIdentity(request, allocator, io) catch {
        try response.apiError(request, .service_unavailable, request_id, cors);
        return;
    };
    switch (record_play.execute(
        allocator,
        metric_store,
        dedup_store,
        collection,
        id,
        identity.listener,
        ref_code,
    )) {
        .recorded => |value| {
            if (value.dedup.status == .unavailable)
                std.log.warn("play dedup unavailable; counted {s}", .{value.record.uri});
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            if (identity.set_cookie) |cookie| {
                try response.jsonWithHeaders(
                    request,
                    .ok,
                    body,
                    request_id,
                    cors,
                    &.{.{ .name = "set-cookie", .value = cookie }},
                );
            } else try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_id, .invalid_request => try response.apiError(request, .invalid_request, request_id, cors),
        .not_found => try response.apiError(request, .not_found, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}

const ListenerIdentity = struct {
    listener: record_play.Listener,
    set_cookie: ?[]const u8,
};

fn listenerIdentity(
    request: *const std.http.Server.Request,
    allocator: std.mem.Allocator,
    io: std.Io,
) !ListenerIdentity {
    if (playCookie(request)) |cookie| return .{
        .listener = .{ .dedup_key = try std.fmt.allocPrint(allocator, "anon:{s}", .{cookie}) },
        .set_cookie = null,
    };

    var random: [16]u8 = undefined;
    io.random(&random);
    const encoded_length = std.base64.url_safe_no_pad.Encoder.calcSize(random.len);
    const token_buffer = try allocator.alloc(u8, encoded_length);
    const token = std.base64.url_safe_no_pad.Encoder.encode(token_buffer, &random);
    return .{
        .listener = .{ .dedup_key = try std.fmt.allocPrint(allocator, "anon:{s}", .{token}) },
        .set_cookie = try std.fmt.allocPrint(
            allocator,
            "plyr_play_id={s}; Max-Age=15552000; Path=/; HttpOnly; Secure; SameSite=Lax",
            .{token},
        ),
    };
}

fn playCookie(request: *const std.http.Server.Request) ?[]const u8 {
    var headers = request.iterateHeaders();
    while (headers.next()) |header| {
        if (!std.ascii.eqlIgnoreCase(header.name, "cookie")) continue;
        var cookies = std.mem.splitScalar(u8, header.value, ';');
        while (cookies.next()) |raw| {
            const cookie = std.mem.trim(u8, raw, " \t");
            const prefix = "plyr_play_id=";
            if (!std.mem.startsWith(u8, cookie, prefix)) continue;
            const value = cookie[prefix.len..];
            if (validPlayCookie(value)) return value;
        }
    }
    return null;
}

fn validPlayCookie(value: []const u8) bool {
    if (value.len != 22) return false;
    for (value) |byte| if (!(std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '_'))
        return false;
    return true;
}

fn parsePlayQuery(allocator: std.mem.Allocator, target: []const u8) !?[]const u8 {
    var iterator = query.Iterator.init(allocator, target);
    var ref_code: ?[]const u8 = null;
    while (try iterator.next()) |pair| {
        if (!std.mem.eql(u8, pair.name, "ref") or ref_code != null or pair.value.len == 0)
            return error.InvalidQuery;
        ref_code = pair.value;
    }
    return ref_code;
}

test "play query accepts at most one non-empty share reference" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expect((try parsePlayQuery(arena.allocator(), "/v1/tracks/x/plays")) == null);
    try std.testing.expectEqualStrings(
        "abcdEF_1",
        (try parsePlayQuery(arena.allocator(), "/v1/tracks/x/plays?ref=abcdEF_1")).?,
    );
    try std.testing.expectError(
        error.InvalidQuery,
        parsePlayQuery(arena.allocator(), "/v1/tracks/x/plays?ref=a&ref=b"),
    );
}

test "anonymous play cookies require one canonical 128-bit token" {
    try std.testing.expect(validPlayCookie("abcdefghijklmnopqrstuv"));
    try std.testing.expect(!validPlayCookie("short"));
    try std.testing.expect(!validPlayCookie("abcdefghijklmnopqrstu/"));
}

test "v1 track JSON keeps authority and projections separate" {
    const domain = @import("../internal/domain/track.zig");
    const allocator = std.testing.allocator;
    const value: domain.Track = .{
        .id = "trk_example",
        .record = .{
            .uri = "at://did:plc:abc/fm.plyr.dev.track/3m123abc",
            .cid = "bafyreexample",
            .revision = "3m123rev",
            .collection = "fm.plyr.dev.track",
            .rkey = "3m123abc",
        },
        .metadata = .{
            .title = "No Local IDs",
            .description = null,
            .album = null,
            .duration_seconds = 180,
            .created_at = "2026-08-08 12:00:00+00",
        },
        .artist = .{
            .did = "did:plc:abc",
            .profile = .{
                .handle = "artist.example",
                .display_name = "Artist",
                .avatar_url = null,
            },
        },
        .media = .{ .artifacts = &.{}, .origins = &.{} },
        .access = .{
            .visibility = .public,
            .in_discovery = true,
            .gate = null,
            .space_uri = null,
        },
        .moderation = .{
            .self_labels = &.{},
            .operator_labels = &.{},
            .override = null,
        },
        .metrics = .{ .play_count = 0 },
        .projection = .{ .indexed_at = null, .verification = .legacy_unverified },
    };

    const json = try std.json.Stringify.valueAlloc(allocator, value, .{});
    defer allocator.free(json);
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, json, .{});
    defer parsed.deinit();
    const root = parsed.value.object;
    try std.testing.expectEqualStrings("track", root.get("object").?.string);
    try std.testing.expect(root.get("record") != null);
    try std.testing.expect(root.get("media") != null);
    try std.testing.expect(root.get("metrics") != null);
    try std.testing.expect(root.get("projection") != null);
    try std.testing.expect(root.get("sources") != null);
    try std.testing.expect(root.get("file_id") == null);
    try std.testing.expect(root.get("r2_url") == null);
}

test "v1 playback JSON exposes authorization availability and integrity" {
    const domain = @import("../internal/domain/playback.zig");
    const allocator = std.testing.allocator;
    const value: domain.Playback = .{
        .track_id = "trk_example",
        .record = .{
            .uri = "at://did:plc:abc/fm.plyr.dev.track/3m123abc",
            .cid = "bafyreexample",
            .revision = "3m123rev",
        },
        .availability = .{
            .status = .available,
            .artifact = .{
                .cid = "bafkblob",
                .media_type = "audio/mpeg",
                .byte_length = 1234,
            },
            .delivery = .{
                .url = "https://audio.example/track.mp3",
                .media_type = "audio/mpeg",
                .artifact_cid = "bafkblob",
                .source = .verified_delivery,
                .integrity = .verified_blob_cid,
            },
        },
    };

    const json = try std.json.Stringify.valueAlloc(allocator, value, .{});
    defer allocator.free(json);
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, json, .{});
    defer parsed.deinit();
    const root = parsed.value.object;
    try std.testing.expectEqualStrings("playback", root.get("object").?.string);
    try std.testing.expectEqualStrings("anonymous", root.get("authorization").?.object.get("audience").?.string);
    const availability = root.get("availability").?.object;
    try std.testing.expectEqualStrings("available", availability.get("status").?.string);
    try std.testing.expectEqualStrings(
        "verified_blob_cid",
        availability.get("delivery").?.object.get("integrity").?.string,
    );
    try std.testing.expect(root.get("file_id") == null);
    try std.testing.expect(root.get("r2_url") == null);
}
