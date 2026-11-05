const std = @import("std");
const get_track = @import("../internal/application/get_track.zig");
const get_playback = @import("../internal/application/get_playback.zig");
const list_track_likes = @import("../internal/application/list_track_likes.zig");
const list_tracks = @import("../internal/application/list_tracks.zig");
const record_play = @import("../internal/application/record_play.zig");
const PlaybackStore = @import("../internal/index/playback_store.zig").PlaybackStore;
const LikeQueryStore = @import("../internal/index/like_query_store.zig").LikeQueryStore;
const TrackStore = @import("../internal/index/track_store.zig").TrackStore;
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

pub fn likes(
    request: *std.http.Server.Request,
    allocator: std.mem.Allocator,
    track_store: ?TrackStore,
    like_store: ?LikeQueryStore,
    track_collection: []const u8,
    like_collection: []const u8,
    profile_collection: []const u8,
    cors: response.CorsPolicy,
    id: []const u8,
    request_id: []const u8,
) !void {
    switch (list_track_likes.execute(
        allocator,
        track_store,
        like_store,
        track_collection,
        like_collection,
        profile_collection,
        id,
        request.head.target,
    )) {
        .found => |value| {
            const body = try std.json.Stringify.valueAlloc(allocator, value, .{});
            try response.json(request, .ok, body, request_id, cors);
        },
        .invalid_request, .invalid_id => try response.apiError(request, .invalid_request, request_id, cors),
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
    const result = get_playback.execute(allocator, store, collection, id);
    std.log.info("playback request={s} track={s} result={s}", .{ request_id, id, @tagName(result) });
    switch (result) {
        .found => |value| {
            std.log.info("playback request={s} availability={s} delivery={any} artifact={any}", .{
                request_id, @tagName(value.availability.status), value.availability.delivery != null, value.availability.artifact != null,
            });
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
    collection: []const u8,
    cors: response.CorsPolicy,
    io: std.Io,
    id: []const u8,
    request_id: []const u8,
) !void {
    const started = std.Io.Timestamp.now(io, .awake);
    const occurrence = parsePlayQuery(allocator, request.head.target) catch {
        try response.apiError(request, .invalid_request, request_id, cors);
        return;
    };
    const identity = listenerIdentity(request, allocator, io) catch {
        try response.apiError(request, .service_unavailable, request_id, cors);
        return;
    };
    const result = record_play.execute(
        allocator,
        metric_store,
        collection,
        id,
        identity.listener,
        occurrence,
    );
    std.log.info("play request={s} occurrence={s} track={s} result={s} elapsed_ms={d}", .{ request_id, occurrence, id, @tagName(result), @divTrunc(started.durationTo(std.Io.Timestamp.now(io, .awake)).nanoseconds, std.time.ns_per_ms) });
    switch (result) {
        .recorded => |value| {
            std.log.info("play request={s} occurrence={s} track={s} status={s} counted={any} total={d} elapsed_ms={d}", .{ request_id, value.occurrence, id, @tagName(value.dedup.status), value.counted, value.play_count, @divTrunc(started.durationTo(std.Io.Timestamp.now(io, .awake)).nanoseconds, std.time.ns_per_ms) });
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
        .conflict => try response.apiError(request, .conflict, request_id, cors),
        .internal_error => try response.apiError(request, .internal_error, request_id, cors),
        .unavailable => try response.apiError(request, .service_unavailable, request_id, cors),
    }
}

const ListenerIdentity = struct {
    listener: []const u8,
    set_cookie: ?[]const u8,
};

fn listenerIdentity(
    request: *const std.http.Server.Request,
    allocator: std.mem.Allocator,
    io: std.Io,
) !ListenerIdentity {
    if (playCookie(request)) |cookie| return .{
        .listener = cookie,
        .set_cookie = null,
    };

    var random: [16]u8 = undefined;
    io.random(&random);
    const encoded_length = std.base64.url_safe_no_pad.Encoder.calcSize(random.len);
    const token_buffer = try allocator.alloc(u8, encoded_length);
    const token = std.base64.url_safe_no_pad.Encoder.encode(token_buffer, &random);
    return .{
        .listener = token,
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

fn parsePlayQuery(allocator: std.mem.Allocator, target: []const u8) ![]const u8 {
    var iterator = query.Iterator.init(allocator, target);
    var occurrence: ?[]const u8 = null;
    while (try iterator.next()) |pair| {
        if (!std.mem.eql(u8, pair.name, "occurrence") or occurrence != null or !record_play.validOccurrence(pair.value))
            return error.InvalidQuery;
        occurrence = pair.value;
    }
    return occurrence orelse error.InvalidQuery;
}

test "play query requires exactly one canonical occurrence" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectError(error.InvalidQuery, parsePlayQuery(arena.allocator(), "/v1/tracks/x/plays"));
    try std.testing.expectEqualStrings(
        "01234567-89ab-4def-8123-456789abcdef",
        try parsePlayQuery(arena.allocator(), "/v1/tracks/x/plays?occurrence=01234567-89ab-4def-8123-456789abcdef"),
    );
    try std.testing.expectError(error.InvalidQuery, parsePlayQuery(arena.allocator(), "/v1/tracks/x/plays?occurrence=01234567-89ab-4def-8123-456789abcdef&occurrence=01234567-89ab-4def-8123-456789abcdef"));
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
