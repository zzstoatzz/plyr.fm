//! PostgreSQL adapter for the rebuildable track projection.
//!
//! This query only reads the app-view index. Its key is the canonical AT-URI;
//! no local integer identity crosses the boundary into the domain model.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const content_cid = @import("../content/cid.zig");
const track = @import("../domain/track.zig");
const track_id = @import("../identity/track_id.zig");
const TrackStore = @import("track_store.zig").TrackStore;

pub const PostgresTrackStore = struct {
    pool: *pg.Pool,

    pub fn init(allocator: std.mem.Allocator, io: std.Io, database_url: []const u8) !PostgresTrackStore {
        return initWithPoolSize(allocator, io, database_url, 8);
    }

    fn initWithPoolSize(
        allocator: std.mem.Allocator,
        io: std.Io,
        database_url: []const u8,
        pool_size: u16,
    ) !PostgresTrackStore {
        const uri = try std.Uri.parse(database_url);
        return .{ .pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = pool_size }) };
    }

    pub fn deinit(self: *PostgresTrackStore) void {
        self.pool.deinit();
    }

    pub fn store(self: *PostgresTrackStore) TrackStore {
        return .{ .context = self, .get_by_uri_fn = getByUriOpaque };
    }

    fn getByUriOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        at_uri: []const u8,
    ) TrackStore.Error!?track.Track {
        const self: *PostgresTrackStore = @ptrCast(@alignCast(context));
        return self.getByUri(allocator, at_uri);
    }

    fn getByUri(
        self: *PostgresTrackStore,
        allocator: std.mem.Allocator,
        at_uri: []const u8,
    ) TrackStore.Error!?track.Track {
        var query_row = self.pool.row(query, .{at_uri}) catch |err| {
            std.log.err("PostgreSQL track lookup failed: {}", .{err});
            return error.IndexUnavailable;
        } orelse return null;
        var query_row_active = true;
        defer if (query_row_active) forceReleaseQueryRow(&query_row);

        const result = decodeRow(allocator, &query_row) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => {
                std.log.err("track projection decode failed: {}", .{err});
                return error.CorruptProjection;
            },
        };
        finishQueryRow(&query_row) catch |err| {
            std.log.err("PostgreSQL track result cleanup failed: {}", .{err});
            query_row_active = false;
            return error.IndexUnavailable;
        };
        query_row_active = false;
        return result;
    }

    fn decodeRow(
        allocator: std.mem.Allocator,
        query_row: *pg.QueryRow,
    ) !track.Track {
        const row = &query_row.row;

        const uri = try duplicate(allocator, try row.get([]const u8, 0));
        const parsed_uri = zat.AtUri.parse(uri) orelse return error.CorruptTrackUri;
        const collection = parsed_uri.collection() orelse return error.CorruptTrackUri;
        const rkey = parsed_uri.rkey() orelse return error.CorruptTrackUri;
        const artist_did = try duplicate(allocator, try row.get([]const u8, 8));
        if (!std.mem.eql(u8, parsed_uri.authority(), artist_did)) return error.CorruptTrackAuthority;

        const id = try allocator.alloc(u8, track_id.encodedLength(uri));
        _ = try track_id.encode(id, uri);

        const pds_blob_cid = try duplicateOptional(allocator, try row.get(?[]const u8, 12));
        const playback_url = try duplicateOptional(allocator, try row.get(?[]const u8, 14));

        const artifacts = if (pds_blob_cid) |cid| blk: {
            const parsed_cid = content_cid.parse(cid) catch return error.CorruptArtifactCid;
            if (parsed_cid.codec != .raw) return error.CorruptArtifactCid;
            const values = try allocator.alloc(track.Artifact, 1);
            values[0] = .{
                .cid = cid,
                .byte_length = try row.get(?i64, 13),
                .media_type = try duplicate(allocator, try row.get([]const u8, 15)),
                .declared_by = uri,
                // The legacy row persists the authored CID but not the evidence
                // that a mirror was verified against it.
                .verification = .declared,
            };
            break :blk values;
        } else &.{};

        const origins = if (playback_url) |url| blk: {
            const values = try allocator.alloc(track.Origin, 1);
            values[0] = .{
                .url = url,
                .media_type = try duplicate(allocator, try row.get([]const u8, 15)),
                // The legacy table has neither a signed origin attestation nor
                // a persisted proof tying this URL's bytes to the artifact CID.
                .artifact_cid = null,
                .attestation = null,
            };
            break :blk values;
        } else &.{};

        return .{
            .id = id,
            .record = .{
                .uri = uri,
                .cid = try duplicateOptional(allocator, try row.get(?[]const u8, 1)),
                .revision = try duplicateOptional(allocator, try row.get(?[]const u8, 2)),
                .collection = collection,
                .rkey = rkey,
            },
            .metadata = .{
                .title = try duplicate(allocator, try row.get([]const u8, 3)),
                .description = try duplicateOptional(allocator, try row.get(?[]const u8, 4)),
                .album = try duplicateOptional(allocator, try row.get(?[]const u8, 5)),
                .duration_seconds = try row.get(?i64, 6),
                .created_at = try duplicate(allocator, try row.get([]const u8, 7)),
            },
            .artist = .{
                .did = artist_did,
                .profile = .{
                    .handle = try duplicate(allocator, try row.get([]const u8, 9)),
                    .display_name = try duplicate(allocator, try row.get([]const u8, 10)),
                    .avatar_url = try duplicateOptional(allocator, try row.get(?[]const u8, 11)),
                },
            },
            .media = .{
                .artifacts = artifacts,
                .origins = origins,
            },
            .access = .{
                .visibility = try parseEnum(track.Visibility, try row.get([]const u8, 16)),
                .in_discovery = try row.get(bool, 17),
                .gate = if (try row.get(?[]const u8, 18)) |gate_type| .{
                    .type = try parseEnum(track.GateType, gate_type),
                } else null,
                .space_uri = try duplicateOptional(allocator, try row.get(?[]const u8, 19)),
            },
            .moderation = .{
                .self_labels = try parseLabels(allocator, try row.get([]const u8, 20)),
                .operator_labels = try parseLabels(allocator, try row.get([]const u8, 21)),
                .override = if (try row.get(?[]const u8, 22)) |value|
                    try parseEnum(track.ModerationOverride, value)
                else
                    null,
            },
            .metrics = .{ .play_count = try row.get(i64, 23) },
            .projection = .{
                .indexed_at = null,
                .verification = .legacy_unverified,
            },
        };
    }
};

/// Drain and release a successful result. pg.zig's QueryRow.deinit can fail
/// before releasing its connection, so force the Result cleanup on that path.
fn finishQueryRow(query_row: *pg.QueryRow) !void {
    query_row.deinit() catch |err| {
        query_row.result.deinit();
        return err;
    };
}

fn forceReleaseQueryRow(query_row: *pg.QueryRow) void {
    finishQueryRow(query_row) catch |err| {
        // finishQueryRow already released or poisoned the pooled connection.
        std.log.err("forced PostgreSQL result cleanup after error: {}", .{err});
    };
}

const query =
    \\SELECT
    \\  t.atproto_record_uri,
    \\  t.atproto_record_cid,
    \\  t.atproto_record_rev,
    \\  t.title,
    \\  t.description,
    \\  t.extra ->> 'album',
    \\  CASE WHEN jsonb_typeof(t.extra -> 'duration') = 'number'
    \\       THEN (t.extra ->> 'duration')::bigint END,
    \\  to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    \\  a.did,
    \\  a.handle,
    \\  a.display_name,
    \\  a.avatar_url,
    \\  t.pds_blob_cid,
    \\  t.pds_blob_size::bigint,
    \\  t.r2_url,
    \\  t.file_type,
    \\  t.visibility,
    \\  t.visibility IN ('public', 'supporters'),
    \\  t.support_gate ->> 'type',
    \\  t.space_uri,
    \\  t.self_labels::text,
    \\  t.operator_labels::text,
    \\  t.moderation_override,
    \\  t.play_count::bigint
    \\FROM tracks AS t
    \\JOIN artists AS a ON a.did = t.artist_did
    \\WHERE t.atproto_record_uri = $1
    \\  AND t.visibility <> 'private'
    \\  AND COALESCE(t.publish_state, 'published') = 'published'
    \\LIMIT 1
;

fn duplicate(allocator: std.mem.Allocator, value: []const u8) ![]const u8 {
    return allocator.dupe(u8, value);
}

fn duplicateOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |present| try duplicate(allocator, present) else null;
}

fn parseLabels(allocator: std.mem.Allocator, raw: []const u8) ![]const []const u8 {
    const parsed = try std.json.parseFromSlice([]const []const u8, allocator, raw, .{});
    // The request arena owns the parse tree, so intentionally do not deinit it.
    return parsed.value;
}

fn parseEnum(comptime T: type, value: []const u8) !T {
    return std.meta.stringToEnum(T, value) orelse error.CorruptProjectionEnum;
}

test "PostgreSQL adapter reads a complete derived projection" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const database_url = std.mem.span(url_z);
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();

    var store_impl = try PostgresTrackStore.initWithPoolSize(allocator, io, database_url, 1);
    defer store_impl.deinit();

    var database_row = (try store_impl.pool.row("SELECT current_database()", .{})).?;
    const database_name = try allocator.dupe(u8, try database_row.get([]const u8, 0));
    defer allocator.free(database_name);
    try database_row.deinit();
    if (!std.mem.eql(u8, database_name, "relay_test")) return error.UnsafeTestDatabase;

    _ = try store_impl.pool.exec("DROP TABLE IF EXISTS tracks", .{});
    _ = try store_impl.pool.exec("DROP TABLE IF EXISTS artists", .{});
    _ = try store_impl.pool.exec(
        \\CREATE TABLE artists (
        \\  did text PRIMARY KEY,
        \\  handle text NOT NULL,
        \\  display_name text NOT NULL,
        \\  avatar_url text
        \\)
    , .{});
    _ = try store_impl.pool.exec(
        \\CREATE TABLE tracks (
        \\  atproto_record_uri text PRIMARY KEY,
        \\  atproto_record_cid text,
        \\  atproto_record_rev text,
        \\  title text NOT NULL,
        \\  description text,
        \\  extra jsonb NOT NULL DEFAULT '{}',
        \\  created_at timestamptz NOT NULL,
        \\  artist_did text NOT NULL REFERENCES artists(did),
        \\  pds_blob_cid text,
        \\  pds_blob_size integer,
        \\  r2_url text,
        \\  file_type text NOT NULL,
        \\  visibility text NOT NULL,
        \\  support_gate jsonb,
        \\  space_uri text,
        \\  self_labels jsonb NOT NULL DEFAULT '[]',
        \\  operator_labels jsonb NOT NULL DEFAULT '[]',
        \\  moderation_override text,
        \\  play_count integer NOT NULL DEFAULT 0,
        \\  publish_state text
        \\)
    , .{});
    _ = try store_impl.pool.exec(
        "INSERT INTO artists VALUES ($1, $2, $3, $4)",
        .{ "did:plc:artist", "artist.example", "Artist", @as(?[]const u8, null) },
    );
    const uri = "at://did:plc:artist/fm.plyr.dev.track/3m123abc";
    _ = try store_impl.pool.exec(
        \\INSERT INTO tracks (
        \\  atproto_record_uri, atproto_record_cid, atproto_record_rev,
        \\  title, description, extra, created_at, artist_did,
        \\  pds_blob_cid, pds_blob_size, r2_url, file_type, visibility,
        \\  support_gate, self_labels, operator_labels, play_count, publish_state
        \\) VALUES (
        \\  $1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8,
        \\  $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18
        \\)
    , .{
        uri,
        "bafyretrack",
        "3m123rev",
        "First Slice",
        "Canonical where it matters",
        "{\"album\":\"Architecture\",\"duration\":181}",
        "2026-08-08T12:00:00Z",
        "did:plc:artist",
        "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
        @as(i32, 12345),
        "https://cdn.example/audio.mp3",
        "audio/mpeg",
        "public",
        "{\"type\":\"copyright\"}",
        "[\"self-label\"]",
        "[\"operator-label\"]",
        @as(i32, 7),
        "published",
    });

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const value = (try store_impl.getByUri(arena.allocator(), uri)).?;
    try std.testing.expectEqualStrings(uri, value.record.uri);
    try std.testing.expectEqualStrings("Architecture", value.metadata.album.?);
    try std.testing.expectEqual(@as(?i64, 181), value.metadata.duration_seconds);
    try std.testing.expectEqualStrings(
        "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
        value.media.artifacts[0].cid,
    );
    try std.testing.expectEqual(track.ArtifactVerification.declared, value.media.artifacts[0].verification);
    try std.testing.expectEqual(@as(usize, 1), value.media.origins.len);
    try std.testing.expect(value.media.origins[0].artifact_cid == null);
    try std.testing.expect(value.media.origins[0].attestation == null);
    try std.testing.expectEqual(track.ProjectionVerification.legacy_unverified, value.projection.verification);
    try std.testing.expectEqualStrings("self-label", value.moderation.self_labels[0]);
    try std.testing.expectEqual(@as(i64, 7), value.metrics.play_count);
}
