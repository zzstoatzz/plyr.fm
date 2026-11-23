//! Production's `api.plyr.fm/audio/{file_id}` links. Public records name the
//! file on the CDN (`audio.plyr.fm/audio/{file_id}.{ext}`); supporter-gated
//! ones named the API itself. Old embeds, players and other apps still ask the
//! API, so it finds the record that names that file.

const std = @import("std");
const pg = @import("pg");
const public_media = @import("../delivery/public_media.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");

pub const Audio = union(enum) {
    /// a public copy any player may fetch
    public: []const u8,
    /// production gated it behind a supporter check, which next does not carry
    gated,
};

pub const Error = error{IndexUnavailable} || std.mem.Allocator.Error;

/// Production file ids are hex digests; anything else names no file (and could
/// carry LIKE wildcards).
pub fn validFileId(file_id: []const u8) bool {
    if (file_id.len == 0 or file_id.len > 64) return false;
    for (file_id) |c| if (!std.ascii.isAlphanumeric(c)) return false;
    return true;
}

pub const PostgresLegacyAudioStore = struct {
    pool: *pg.Pool,

    pub fn find(self: *PostgresLegacyAudioStore, allocator: std.mem.Allocator, file_id: []const u8) Error!?Audio {
        if (!validFileId(file_id)) return null;
        var row = (self.pool.row(query, .{file_id}) catch return error.IndexUnavailable) orelse return null;
        defer row.deinit() catch {};
        const url = row.get([]const u8, 0) catch return error.IndexUnavailable;
        if (std.mem.startsWith(u8, url, gated_prefix)) return .gated;
        return .{ .public = try public_media.canonical(allocator, try allocator.dupe(u8, url)) };
    }
};

pub const gated_prefix = "https://api.plyr.fm/audio/";

// a public copy wins over a gated one when an artist re-published the file
const query =
    \\SELECT v.audio_url
    \\FROM plyr_index.track_records AS v
    \\JOIN plyr_index.account_availability AS aa ON aa.repo_did = v.owner_did AND aa.available
    \\WHERE NOT v.deleted AND v.audio_space IS NULL AND (
    \\  v.audio_url LIKE 'https://audio.plyr.fm/audio/' || $1 || '.%'
    \\  OR v.audio_url LIKE 'https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev/audio/' || $1 || '.%'
    \\  OR v.audio_url = 'https://api.plyr.fm/audio/' || $1)
    \\ORDER BY (v.audio_url LIKE 'https://api.plyr.fm/%'), v.record_uri
    \\LIMIT 1
;

test "file ids are hex digests" {
    try std.testing.expect(validFileId("89d18ada205c48ad"));
    try std.testing.expect(!validFileId(""));
    try std.testing.expect(!validFileId("a%"));
    try std.testing.expect(!validFileId("a_b"));
    try std.testing.expect(!validFileId("../x"));
}

test "PostgreSQL finds the record that names a production audio file" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    {
        var row = (try pool.row("SELECT current_database()", .{})).?;
        defer row.deinit() catch {};
        if (!std.mem.eql(u8, try row.get([]const u8, 0), "zig_test")) return error.UnsafeTestDatabase;
    }
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.account_availability (repo_did text PRIMARY KEY, available boolean NOT NULL)", .{});
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.track_records (
        \\  record_uri text PRIMARY KEY, owner_did text NOT NULL, audio_url text, audio_space text,
        \\  deleted boolean NOT NULL DEFAULT false
        \\)
    , .{});
    _ = try pool.exec("INSERT INTO plyr_index.account_availability VALUES ('did:plc:a', true), ('did:plc:gone', false)", .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.track_records (record_uri, owner_did, audio_url, audio_space, deleted) VALUES
        \\('at://a/cdn', 'did:plc:a', 'https://audio.plyr.fm/audio/aaaa1111.mp3', NULL, false),
        \\('at://a/r2dev', 'did:plc:a', 'https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev/audio/bbbb2222.m4a', NULL, false),
        \\('at://a/gated', 'did:plc:a', 'https://api.plyr.fm/audio/cccc3333', NULL, false),
        \\('at://a/both-gated', 'did:plc:a', 'https://api.plyr.fm/audio/dddd4444', NULL, false),
        \\('at://a/both-public', 'did:plc:a', 'https://audio.plyr.fm/audio/dddd4444.mp3', NULL, false),
        \\('at://a/deleted', 'did:plc:a', 'https://audio.plyr.fm/audio/eeee5555.mp3', NULL, true),
        \\('at://gone/1', 'did:plc:gone', 'https://audio.plyr.fm/audio/ffff6666.mp3', NULL, false),
        \\('at://a/prefix', 'did:plc:a', 'https://audio.plyr.fm/audio/aaaa1111extra.mp3', NULL, false)
    , .{});
    var store: PostgresLegacyAudioStore = .{ .pool = pool };
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    try std.testing.expectEqualStrings("https://audio.plyr.fm/audio/aaaa1111.mp3", (try store.find(a, "aaaa1111")).?.public);
    try std.testing.expectEqualStrings("https://audio.plyr.fm/audio/bbbb2222.m4a", (try store.find(a, "bbbb2222")).?.public);
    try std.testing.expect((try store.find(a, "cccc3333")).? == .gated);
    try std.testing.expectEqualStrings("https://audio.plyr.fm/audio/dddd4444.mp3", (try store.find(a, "dddd4444")).?.public);
    try std.testing.expect((try store.find(a, "eeee5555")) == null);
    try std.testing.expect((try store.find(a, "ffff6666")) == null);
    try std.testing.expect((try store.find(a, "a%")) == null);
}
