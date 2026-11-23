//! Production's supporter-gated tracks kept their audio in its private bucket,
//! and next carries no supporter check for them: until the artist closes the
//! track again with next's own access, only its owner may play it. The owner
//! proves who they are with the same grant that admits their uploads, and gets
//! a short-lived link the audio worker serves from that bucket.

const std = @import("std");
const pg = @import("pg");
const logfire = @import("logfire");
const service_auth = @import("../atproto/service_auth.zig");
const admission = @import("admission.zig");
const legacy_audio = @import("../index/postgres_legacy_audio_store.zig");

pub const Request = struct { serviceToken: []const u8, recordUri: []const u8 };
pub const Claim = struct {
    version: u8 = 1,
    kind: []const u8 = "legacy-owner-audio",
    owner: []const u8,
    fileId: []const u8,
    expiresAt: i64,
};

/// Long enough to play a long track through; the worker refuses anything longer.
pub const lifetime_seconds = 3600;

/// The production file the owner's record names, or why there is none to give.
pub fn fileId(owner: []const u8, record_uri: []const u8, collection: []const u8, audio_url: ?[]const u8) ![]const u8 {
    _ = admission.recordKey(record_uri, owner, collection) catch return error.NotOwner;
    const url = audio_url orelse return error.NotFound;
    if (!std.mem.startsWith(u8, url, legacy_audio.gated_prefix)) return error.NotFound;
    const id = url[legacy_audio.gated_prefix.len..];
    if (!legacy_audio.validFileId(id)) return error.NotFound;
    return id;
}

pub fn authorize(a: std.mem.Allocator, io: std.Io, settings: admission.Settings, pool: *pg.Pool, body: []const u8) ![]const u8 {
    const span = logfire.span("playback.owner_audio", .{});
    defer span.end();
    const request = std.json.parseFromSliceLeaky(Request, a, body, .{}) catch return error.InvalidRequest;
    span.setAttribute("playback.record_uri", request.recordUri);
    const owner = (try service_auth.verifyResolved(a, io, request.serviceToken, settings.identity)).issuer;
    span.setAttribute("playback.viewer_did", owner);
    // checked before the lookup, so a listener learns nothing about the record
    _ = admission.recordKey(request.recordUri, owner, settings.track_collection) catch return error.NotOwner;
    var row = (pool.row(query, .{request.recordUri}) catch return error.IndexUnavailable) orelse return error.NotFound;
    defer row.deinit() catch {};
    const url = try a.dupe(u8, row.get([]const u8, 0) catch return error.IndexUnavailable);
    const id = try fileId(owner, request.recordUri, settings.track_collection, url);
    const expiry = (std.Io.Timestamp.now(io, .real).toSeconds() + lifetime_seconds) * 1000;
    const capability = try admission.sign(a, Claim{ .owner = owner, .fileId = id, .expiresAt = expiry }, settings.secret);
    return std.json.Stringify.valueAlloc(a, .{
        .url = try std.fmt.allocPrint(a, "{s}/v1/legacy-audio/{s}?capability={s}", .{ settings.base_url, id, capability }),
        .expiresAt = expiry,
    }, .{});
}

const query =
    \\SELECT v.audio_url
    \\FROM plyr_index.track_records AS v
    \\JOIN plyr_index.account_availability AS aa ON aa.repo_did = v.owner_did AND aa.available
    \\WHERE v.record_uri = $1 AND NOT v.deleted AND v.audio_space IS NULL AND v.audio_url IS NOT NULL
;

test "only the record's owner gets a link, and only for production's gated audio" {
    const owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    const uri = "at://" ++ owner ++ "/fm.plyr.track/3mtest";
    try std.testing.expectEqualStrings("cccc3333", try fileId(owner, uri, "fm.plyr.track", "https://api.plyr.fm/audio/cccc3333"));
    try std.testing.expectError(error.NotOwner, fileId("did:plc:bbbbbbbbbbbbbbbbbbbbbbbb", uri, "fm.plyr.track", "https://api.plyr.fm/audio/cccc3333"));
    try std.testing.expectError(error.NotOwner, fileId(owner, uri, "fm.plyr.dev.track", "https://api.plyr.fm/audio/cccc3333"));
    try std.testing.expectError(error.NotFound, fileId(owner, uri, "fm.plyr.track", "https://audio.plyr.fm/audio/cccc3333.mp3"));
    try std.testing.expectError(error.NotFound, fileId(owner, uri, "fm.plyr.track", "https://api.plyr.fm/audio/../x"));
    try std.testing.expectError(error.NotFound, fileId(owner, uri, "fm.plyr.track", null));
}

test "the signed link names the owner and the file and nothing an upload accepts" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const token = try admission.sign(a, Claim{ .owner = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", .fileId = "cccc3333", .expiresAt = 1 }, "0123456789abcdef0123456789abcdef");
    const payload = token[0..std.mem.indexOfScalar(u8, token, '.').?];
    const decoded = try a.alloc(u8, try std.base64.url_safe_no_pad.Decoder.calcSizeForSlice(payload));
    try std.base64.url_safe_no_pad.Decoder.decode(decoded, payload);
    try std.testing.expectEqualStrings("{\"version\":1,\"kind\":\"legacy-owner-audio\",\"owner\":\"did:plc:aaaaaaaaaaaaaaaaaaaaaaaa\",\"fileId\":\"cccc3333\",\"expiresAt\":1}", decoded);
}
