//! PostgreSQL adapter for the rebuildable track projection.
//!
//! This query only reads the app-view index. Its key is the canonical AT-URI;
//! no local integer identity crosses the boundary into the domain model.

const std = @import("std");
const pg = @import("pg");
const postgres_test_lock = @import("../testing/postgres_lock.zig");
const zat = @import("zat");
const track = @import("../domain/track.zig");
const track_id = @import("../identity/track_id.zig");
const artist_index = @import("artist_store.zig");
const PostgresArtistStore = @import("postgres_artist_store.zig").PostgresArtistStore;
const PostgresAlbumStore = @import("postgres_album_store.zig").PostgresAlbumStore;
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
        return .{
            .context = self,
            .get_by_uri_fn = getByUriOpaque,
            .list_public_fn = listPublicOpaque,
            .ready_fn = readyOpaque,
        };
    }

    fn readyOpaque(context: *anyopaque) bool {
        const self: *PostgresTrackStore = @ptrCast(@alignCast(context));
        var query_row = self.pool.row("SELECT 1", .{}) catch |err| {
            std.log.err("PostgreSQL readiness probe failed: {}", .{err});
            return false;
        } orelse return false;
        finishQueryRow(&query_row) catch |err| {
            std.log.err("PostgreSQL readiness cleanup failed: {}", .{err});
            return false;
        };
        return true;
    }

    fn getByUriOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        at_uri: []const u8,
    ) TrackStore.Error!?track.Track {
        const self: *PostgresTrackStore = @ptrCast(@alignCast(context));
        return self.getByUri(allocator, at_uri);
    }

    fn listPublicOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: @import("track_store.zig").ListRequest,
    ) TrackStore.Error![]@import("track_store.zig").ListItem {
        const self: *PostgresTrackStore = @ptrCast(@alignCast(context));
        return self.listPublic(allocator, request);
    }

    fn getByUri(
        self: *PostgresTrackStore,
        allocator: std.mem.Allocator,
        at_uri: []const u8,
    ) TrackStore.Error!?track.Track {
        var query_row = self.pool.row(detail_query, .{at_uri}) catch |err| {
            std.log.err("PostgreSQL track lookup failed: {}", .{err});
            return error.IndexUnavailable;
        } orelse return null;
        var query_row_active = true;
        defer if (query_row_active) forceReleaseQueryRow(&query_row);

        const result = decodeRow(allocator, &query_row.row) catch |err| switch (err) {
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

    fn listPublic(
        self: *PostgresTrackStore,
        allocator: std.mem.Allocator,
        request: @import("track_store.zig").ListRequest,
    ) TrackStore.Error![]@import("track_store.zig").ListItem {
        const limit: i64 = @intCast(request.limit);
        var result = switch (request.scope) {
            .discovery => if (request.after) |after|
                self.pool.query(discovery_after_query, .{
                    request.collection,
                    after.created_at_us,
                    after.at_uri,
                    limit,
                }) catch |err| {
                    std.log.err("PostgreSQL discovery collection query failed: {}", .{err});
                    return error.IndexUnavailable;
                }
            else
                self.pool.query(discovery_query, .{ request.collection, limit }) catch |err| {
                    std.log.err("PostgreSQL discovery collection query failed: {}", .{err});
                    return error.IndexUnavailable;
                },
            .artist => |artist_did| if (request.after) |after|
                self.pool.query(artist_after_query, .{
                    request.collection,
                    artist_did,
                    after.created_at_us,
                    after.at_uri,
                    limit,
                }) catch |err| {
                    std.log.err("PostgreSQL artist track collection query failed: {}", .{err});
                    return error.IndexUnavailable;
                }
            else
                self.pool.query(artist_query, .{
                    request.collection,
                    artist_did,
                    limit,
                }) catch |err| {
                    std.log.err("PostgreSQL artist track collection query failed: {}", .{err});
                    return error.IndexUnavailable;
                },
        };
        defer result.deinit();

        var items: std.ArrayListUnmanaged(@import("track_store.zig").ListItem) = .empty;
        errdefer items.deinit(allocator);
        while (result.next() catch |err| {
            std.log.err("PostgreSQL track collection read failed: {}", .{err});
            return error.IndexUnavailable;
        }) |row_value| {
            const row = &row_value;
            const value = decodeRow(allocator, row) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => {
                    std.log.err("track collection projection decode failed: {}", .{err});
                    return error.CorruptProjection;
                },
            };
            const created_at_us = row.get(i64, 24) catch |err| {
                std.log.err("track collection sort key decode failed: {}", .{err});
                return error.CorruptProjection;
            };
            items.append(allocator, .{
                .value = value,
                .created_at_us = created_at_us,
            }) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }

    fn decodeRow(
        allocator: std.mem.Allocator,
        row: anytype,
    ) !track.Track {
        return decodeRowAt(allocator, row, 0);
    }

    /// Decode the shared track projection from a wider joined result.
    pub fn decodeRowAt(
        allocator: std.mem.Allocator,
        row: anytype,
        base: usize,
    ) !track.Track {
        const uri = try duplicate(allocator, try row.get([]const u8, base + 0));
        const parsed_uri = zat.AtUri.parse(uri) orelse return error.CorruptTrackUri;
        const collection = parsed_uri.collection() orelse return error.CorruptTrackUri;
        const rkey = parsed_uri.rkey() orelse return error.CorruptTrackUri;
        const artist_did = try duplicate(allocator, try row.get([]const u8, base + 8));
        if (!std.mem.eql(u8, parsed_uri.authority(), artist_did)) return error.CorruptTrackAuthority;

        const id = try allocator.alloc(u8, track_id.encodedLength(uri));
        _ = try track_id.encode(id, uri);

        const pds_blob_cid = try duplicateOptional(allocator, try row.get(?[]const u8, base + 12));
        const playback_url = try duplicateOptional(allocator, try row.get(?[]const u8, base + 14));

        const artifacts = if (pds_blob_cid) |cid| blk: {
            const parsed_cid = zat.Cid.fromString(allocator, cid) catch return error.CorruptArtifactCid;
            defer allocator.free(parsed_cid.raw);
            if (parsed_cid.codec() != zat.cbor.Codec.raw) return error.CorruptArtifactCid;
            const values = try allocator.alloc(track.Artifact, 1);
            values[0] = .{
                .cid = cid,
                .byte_length = try row.get(?i64, base + 13),
                .media_type = try duplicate(allocator, try row.get([]const u8, base + 15)),
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
                .media_type = try duplicate(allocator, try row.get([]const u8, base + 15)),
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
                .cid = try duplicateOptional(allocator, try row.get(?[]const u8, base + 1)),
                .revision = try duplicateOptional(allocator, try row.get(?[]const u8, base + 2)),
                .collection = collection,
                .rkey = rkey,
            },
            .metadata = .{
                .title = try duplicate(allocator, try row.get([]const u8, base + 3)),
                .description = try duplicateOptional(allocator, try row.get(?[]const u8, base + 4)),
                .album = try duplicateOptional(allocator, try row.get(?[]const u8, base + 5)),
                .duration_seconds = try row.get(?i64, base + 6),
                .created_at = try duplicate(allocator, try row.get([]const u8, base + 7)),
            },
            .artist = .{
                .did = artist_did,
                .profile = .{
                    .handle = try duplicate(allocator, try row.get([]const u8, base + 9)),
                    .display_name = try duplicate(allocator, try row.get([]const u8, base + 10)),
                    .avatar_url = try duplicateOptional(allocator, try row.get(?[]const u8, base + 11)),
                },
            },
            .media = .{
                .artifacts = artifacts,
                .origins = origins,
            },
            .access = .{
                .visibility = try parseEnum(track.Visibility, try row.get([]const u8, base + 16)),
                .in_discovery = try row.get(bool, base + 17),
                .gate = if (try row.get(?[]const u8, base + 18)) |gate_type| .{
                    .type = try parseEnum(track.GateType, gate_type),
                } else null,
                .space_uri = try duplicateOptional(allocator, try row.get(?[]const u8, base + 19)),
            },
            .moderation = .{
                .self_labels = try parseLabels(allocator, try row.get([]const u8, base + 20)),
                .operator_labels = try parseLabels(allocator, try row.get([]const u8, base + 21)),
                .override = if (try row.get(?[]const u8, base + 22)) |value|
                    try parseEnum(track.ModerationOverride, value)
                else
                    null,
            },
            .metrics = .{ .play_count = try row.get(i64, base + 23) },
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

pub const projected_columns =
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
;

pub const projected_fields = "SELECT\n" ++ projected_columns;

const from_tracks =
    \\FROM tracks AS t
    \\JOIN artists AS a ON a.did = t.artist_did
;

const detail_query = projected_fields ++ "\n" ++ from_tracks ++ "\n" ++
    \\WHERE t.atproto_record_uri = $1
    \\  AND t.visibility <> 'private'
    \\  AND COALESCE(t.publish_state, 'published') = 'published'
    \\LIMIT 1
;

const list_projection = projected_fields ++
    "\n, (extract(epoch FROM t.created_at) * 1000000)::bigint\n" ++
    from_tracks;

const public_policy =
    \\  AND t.atproto_record_uri IS NOT NULL
    \\  AND split_part(t.atproto_record_uri, '/', 4) = $1
    \\  AND COALESCE(t.publish_state, 'published') = 'published'
    \\  AND a.deactivated = false
    \\  AND t.moderation_override IS DISTINCT FROM 'exclude'
    \\  AND (
    \\    t.moderation_override IS NOT DISTINCT FROM 'allow'
    \\    OR NOT (
    \\      t.self_labels ?| ARRAY['copyright-violation']
    \\      OR t.operator_labels ?| ARRAY['copyright-violation']
    \\    )
    \\  )
;

const discovery_policy = public_policy ++
    \\  AND t.visibility IN ('public', 'supporters')
    \\  AND NOT (
    \\    t.self_labels ?| ARRAY['sexual', 'porn']
    \\    OR t.operator_labels ?| ARRAY['sexual', 'porn']
    \\  )
;

const artist_policy = public_policy ++
    \\  AND t.artist_did = $2
    \\  AND t.visibility <> 'private'
;

const discovery_query = list_projection ++ "\n" ++
    \\WHERE true
++ discovery_policy ++ "\n" ++
    \\ORDER BY t.created_at DESC, t.atproto_record_uri DESC
    \\LIMIT $2::bigint
;

const discovery_after_query = list_projection ++ "\n" ++
    \\WHERE true
++ discovery_policy ++ "\n" ++
    \\  AND (
    \\    t.created_at < TIMESTAMPTZ 'epoch' + ($2::bigint * INTERVAL '1 microsecond')
    \\    OR (
    \\      t.created_at = TIMESTAMPTZ 'epoch' + ($2::bigint * INTERVAL '1 microsecond')
    \\      AND t.atproto_record_uri < $3
    \\    )
    \\  )
    \\ORDER BY t.created_at DESC, t.atproto_record_uri DESC
    \\LIMIT $4::bigint
;

const artist_query = list_projection ++ "\n" ++
    \\WHERE true
++ artist_policy ++ "\n" ++
    \\ORDER BY t.created_at DESC, t.atproto_record_uri DESC
    \\LIMIT $3::bigint
;

const artist_after_query = list_projection ++ "\n" ++
    \\WHERE true
++ artist_policy ++ "\n" ++
    \\  AND (
    \\    t.created_at < TIMESTAMPTZ 'epoch' + ($3::bigint * INTERVAL '1 microsecond')
    \\    OR (
    \\      t.created_at = TIMESTAMPTZ 'epoch' + ($3::bigint * INTERVAL '1 microsecond')
    \\      AND t.atproto_record_uri < $4
    \\    )
    \\  )
    \\ORDER BY t.created_at DESC, t.atproto_record_uri DESC
    \\LIMIT $5::bigint
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
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);

    var store_impl = try PostgresTrackStore.initWithPoolSize(allocator, io, database_url, 1);
    defer store_impl.deinit();
    try std.testing.expect(store_impl.store().ready());

    var database_row = (try store_impl.pool.row("SELECT current_database()", .{})).?;
    const database_name = try allocator.dupe(u8, try database_row.get([]const u8, 0));
    defer allocator.free(database_name);
    try database_row.deinit();
    if (!std.mem.eql(u8, database_name, "relay_test")) return error.UnsafeTestDatabase;

    _ = try store_impl.pool.exec("DROP TABLE IF EXISTS tracks CASCADE", .{});
    _ = try store_impl.pool.exec("DROP TABLE IF EXISTS albums CASCADE", .{});
    _ = try store_impl.pool.exec("DROP TABLE IF EXISTS user_preferences CASCADE", .{});
    _ = try store_impl.pool.exec("DROP TABLE IF EXISTS artists CASCADE", .{});
    _ = try store_impl.pool.exec(
        \\CREATE TABLE artists (
        \\  did text PRIMARY KEY,
        \\  handle text NOT NULL,
        \\  display_name text NOT NULL,
        \\  bio text,
        \\  avatar_url text,
        \\  deactivated boolean NOT NULL DEFAULT false,
        \\  created_at timestamptz NOT NULL DEFAULT now(),
        \\  updated_at timestamptz NOT NULL DEFAULT now()
        \\)
    , .{});
    _ = try store_impl.pool.exec(
        \\CREATE TABLE user_preferences (
        \\  did text PRIMARY KEY REFERENCES artists(did),
        \\  show_liked_on_profile boolean NOT NULL DEFAULT false,
        \\  support_url text
        \\)
    , .{});
    _ = try store_impl.pool.exec(
        \\CREATE TABLE albums (
        \\  id text PRIMARY KEY,
        \\  artist_did text NOT NULL REFERENCES artists(did),
        \\  slug text NOT NULL,
        \\  title text NOT NULL,
        \\  description text,
        \\  image_id text,
        \\  image_url text,
        \\  atproto_record_uri text,
        \\  atproto_record_cid text,
        \\  created_at timestamptz NOT NULL,
        \\  updated_at timestamptz NOT NULL
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
        \\  album_id text REFERENCES albums(id),
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
        "INSERT INTO artists (did, handle, display_name, avatar_url) VALUES ($1, $2, $3, $4)",
        .{ "did:plc:artist", "artist.example", "Artist", @as(?[]const u8, null) },
    );
    _ = try store_impl.pool.exec(
        "UPDATE artists SET bio = 'sound maker', created_at = '2026-08-08T10:00:00Z', updated_at = '2026-08-08T11:00:00Z' WHERE did = 'did:plc:artist'",
        .{},
    );
    _ = try store_impl.pool.exec(
        "INSERT INTO user_preferences VALUES ('did:plc:artist', true, 'atprotofans')",
        .{},
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

    var artist_store_impl: PostgresArtistStore = .{ .pool = store_impl.pool };
    const artist_store = artist_store_impl.store();
    const artist_value = (try artist_store.get(arena.allocator(), .{ .did = "did:plc:artist" })).?;
    try std.testing.expectEqualStrings("artist.example", artist_value.handle);
    try std.testing.expectEqualStrings("sound maker", artist_value.bio.?);
    try std.testing.expect(artist_value.show_liked_on_profile);
    try std.testing.expectEqualStrings("atprotofans", artist_value.support_url.?);
    try std.testing.expectEqualStrings("2026-08-08T10:00:00.000000Z", artist_value.created_at);
    try std.testing.expectEqual(@import("../domain/artist.zig").ClaimSource.legacy_projection, artist_value.sources.profile);
    try std.testing.expectEqual(@import("../domain/artist.zig").ClaimSource.legacy_local, artist_value.sources.public_preferences);

    const by_handle = (try artist_store.get(arena.allocator(), .{ .handle = "artist.example" })).?;
    try std.testing.expectEqualStrings("did:plc:artist", by_handle.did);
    try std.testing.expect((try artist_store.get(arena.allocator(), .{ .did = "did:plc:missing" })) == null);

    _ = try store_impl.pool.exec(
        \\INSERT INTO artists (did, handle, display_name, deactivated) VALUES
        \\  ('did:plc:inactive', 'inactive.example', 'Inactive', true),
        \\  ('did:plc:alias-one', 'shared.example', 'One', false),
        \\  ('did:plc:alias-two', 'SHARED.EXAMPLE', 'Two', false)
    , .{});
    try std.testing.expect((try artist_store.get(arena.allocator(), .{ .did = "did:plc:inactive" })) == null);
    try std.testing.expectError(
        artist_index.ArtistStore.Error.CorruptProjection,
        artist_store.get(arena.allocator(), .{ .handle = "shared.example" }),
    );

    const record_cid = "bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
    const album_a_uri = "at://did:plc:artist/fm.plyr.dev.list/albuma";
    const album_b_uri = "at://did:plc:artist/fm.plyr.dev.list/albumb";
    const other_album_uri = "at://did:plc:alias-one/fm.plyr.dev.list/other";
    _ = try store_impl.pool.exec(
        \\INSERT INTO albums (
        \\  id, artist_did, slug, title, description, image_url,
        \\  atproto_record_uri, atproto_record_cid, created_at, updated_at
        \\) VALUES
        \\  ('album-a', 'did:plc:artist', 'album-a', 'Album A', 'liner notes',
        \\   'https://cdn.example/album-a.jpg', $1, $4, '2026-08-08T17:00:00Z', '2026-08-08T18:00:00Z'),
        \\  ('album-b', 'did:plc:artist', 'album-b', 'Album B', NULL,
        \\   NULL, $2, $4, '2026-08-08T16:00:00Z', '2026-08-08T16:00:00Z'),
        \\  ('local-only', 'did:plc:artist', 'local-only', 'Local Only', NULL,
        \\   NULL, NULL, NULL, '2026-08-08T19:00:00Z', '2026-08-08T19:00:00Z'),
        \\  ('empty', 'did:plc:artist', 'empty', 'Empty', NULL,
        \\   NULL, 'at://did:plc:artist/fm.plyr.dev.list/empty', $4,
        \\   '2026-08-08T20:00:00Z', '2026-08-08T20:00:00Z'),
        \\  ('other-album', 'did:plc:alias-one', 'other', 'Other', NULL,
        \\   NULL, $3, $4, '2026-08-08T15:00:00Z', '2026-08-08T15:00:00Z')
    , .{ album_a_uri, album_b_uri, other_album_uri, record_cid });

    const newer_uri = "at://did:plc:artist/fm.plyr.dev.track/3m123abe";
    const tied_uri = "at://did:plc:artist/fm.plyr.dev.track/3m123abd";
    const older_uri = "at://did:plc:artist/fm.plyr.dev.track/3m123abb";
    const hidden_uri = "at://did:plc:artist/fm.plyr.dev.track/3m123abf";
    const unlisted_uri = "at://did:plc:artist/fm.plyr.dev.track/3m123abg";
    const private_uri = "at://did:plc:artist/fm.plyr.dev.track/3m123abh";
    const other_uri = "at://did:plc:alias-one/fm.plyr.dev.track/3m123abi";
    _ = try store_impl.pool.exec(
        \\INSERT INTO tracks (
        \\  atproto_record_uri, title, extra, created_at, artist_did,
        \\  file_type, visibility, self_labels, operator_labels,
        \\  play_count, publish_state
        \\) VALUES
        \\  ($1, 'Newer', '{}', '2026-08-08T13:00:00Z', 'did:plc:artist',
        \\   'audio/mpeg', 'public', '[]', '[]', 0, 'published'),
        \\  ($2, 'Tied', '{}', '2026-08-08T12:00:00Z', 'did:plc:artist',
        \\   'audio/mpeg', 'public', '[]', '[]', 0, 'published'),
        \\  ($3, 'Older', '{}', '2026-08-08T11:00:00Z', 'did:plc:artist',
        \\   'audio/mpeg', 'public', '[]', '[]', 0, 'published'),
        \\  ($4, 'Hidden', '{}', '2026-08-08T14:00:00Z', 'did:plc:artist',
        \\   'audio/mpeg', 'public', '["sexual"]', '[]', 0, 'published'),
        \\  ($5, 'Unlisted', '{}', '2026-08-08T15:00:00Z', 'did:plc:artist',
        \\   'audio/mpeg', 'unlisted', '[]', '[]', 0, 'published'),
        \\  ($6, 'Private', '{}', '2026-08-08T16:00:00Z', 'did:plc:artist',
        \\   'audio/mpeg', 'private', '[]', '[]', 0, 'published'),
        \\  ($7, 'Other Artist', '{}', '2026-08-08T10:00:00Z', 'did:plc:alias-one',
        \\   'audio/mpeg', 'public', '[]', '[]', 0, 'published')
    , .{ newer_uri, tied_uri, older_uri, hidden_uri, unlisted_uri, private_uri, other_uri });
    _ = try store_impl.pool.exec(
        \\UPDATE tracks SET album_id = CASE
        \\  WHEN atproto_record_uri IN ($1, $2) THEN 'album-a'
        \\  WHEN atproto_record_uri IN ($3, $4, $5) THEN 'album-b'
        \\  WHEN atproto_record_uri = $6 THEN 'local-only'
        \\  WHEN atproto_record_uri = $7 THEN 'other-album'
        \\END
    , .{ uri, newer_uri, hidden_uri, unlisted_uri, private_uri, older_uri, other_uri });

    var page_arena = std.heap.ArenaAllocator.init(allocator);
    defer page_arena.deinit();
    const first_page = try store_impl.listPublic(page_arena.allocator(), .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 2,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 2), first_page.len);
    try std.testing.expectEqualStrings(newer_uri, first_page[0].value.record.uri);
    try std.testing.expectEqualStrings(tied_uri, first_page[1].value.record.uri);

    const second_page = try store_impl.listPublic(page_arena.allocator(), .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 2,
        .after = .{
            .created_at_us = first_page[1].created_at_us,
            .at_uri = first_page[1].value.record.uri,
        },
    });
    try std.testing.expectEqual(@as(usize, 2), second_page.len);
    try std.testing.expectEqualStrings(uri, second_page[0].value.record.uri);
    try std.testing.expectEqualStrings(older_uri, second_page[1].value.record.uri);

    const artist_page = try store_impl.listPublic(page_arena.allocator(), .{
        .collection = "fm.plyr.dev.track",
        .scope = .{ .artist = "did:plc:artist" },
        .limit = 20,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 6), artist_page.len);
    // An artist catalogue is a content-view context: adult labels remain
    // visible and unlisted public links remain addressable, while discovery
    // above excludes both rows. Private rows remain owner-only.
    try std.testing.expectEqualStrings(unlisted_uri, artist_page[0].value.record.uri);
    try std.testing.expectEqualStrings(hidden_uri, artist_page[1].value.record.uri);
    try std.testing.expectEqualStrings(newer_uri, artist_page[2].value.record.uri);

    const continued_artist_page = try store_impl.listPublic(page_arena.allocator(), .{
        .collection = "fm.plyr.dev.track",
        .scope = .{ .artist = "did:plc:artist" },
        .limit = 2,
        .after = .{
            .created_at_us = artist_page[1].created_at_us,
            .at_uri = artist_page[1].value.record.uri,
        },
    });
    try std.testing.expectEqual(@as(usize, 2), continued_artist_page.len);
    try std.testing.expectEqualStrings(newer_uri, continued_artist_page[0].value.record.uri);
    try std.testing.expectEqualStrings(tied_uri, continued_artist_page[1].value.record.uri);

    const other_artist_page = try store_impl.listPublic(page_arena.allocator(), .{
        .collection = "fm.plyr.dev.track",
        .scope = .{ .artist = "did:plc:alias-one" },
        .limit = 20,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 1), other_artist_page.len);
    try std.testing.expectEqualStrings(other_uri, other_artist_page[0].value.record.uri);

    var album_store_impl: PostgresAlbumStore = .{ .pool = store_impl.pool };
    const album_store = album_store_impl.store();
    const first_album_page = try album_store.listByArtist(page_arena.allocator(), .{
        .collection = "fm.plyr.dev.list",
        .artist_did = "did:plc:artist",
        .limit = 1,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 1), first_album_page.len);
    try std.testing.expectEqualStrings(album_a_uri, first_album_page[0].value.record.uri);
    try std.testing.expectEqualStrings("Album A", first_album_page[0].value.metadata.name);
    try std.testing.expectEqualStrings("liner notes", first_album_page[0].value.presentation.description.?);
    try std.testing.expectEqual(@as(i64, 2), first_album_page[0].value.metrics.track_count);
    try std.testing.expectEqual(@as(i64, 7), first_album_page[0].value.metrics.total_plays);
    try std.testing.expect(std.mem.startsWith(u8, first_album_page[0].value.id, "alb_"));

    const second_album_page = try album_store.listByArtist(page_arena.allocator(), .{
        .collection = "fm.plyr.dev.list",
        .artist_did = "did:plc:artist",
        .limit = 10,
        .after = .{
            .created_at_us = first_album_page[0].created_at_us,
            .at_uri = first_album_page[0].value.record.uri,
        },
    });
    try std.testing.expectEqual(@as(usize, 1), second_album_page.len);
    try std.testing.expectEqualStrings(album_b_uri, second_album_page[0].value.record.uri);
    // Adult-labeled tracks remain visible in a direct album/catalogue view;
    // its private member is not counted.
    try std.testing.expectEqual(@as(i64, 2), second_album_page[0].value.metrics.track_count);

    const other_albums = try album_store.listByArtist(page_arena.allocator(), .{
        .collection = "fm.plyr.dev.list",
        .artist_did = "did:plc:alias-one",
        .limit = 10,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 1), other_albums.len);
    try std.testing.expectEqualStrings(other_album_uri, other_albums[0].value.record.uri);
}
