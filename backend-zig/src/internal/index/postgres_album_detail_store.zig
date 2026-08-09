//! PostgreSQL read adapter for verified album detail and ordered members.

const std = @import("std");
const pg = @import("pg");
const postgres_test_lock = @import("../testing/postgres_lock.zig");
const zat = @import("zat");
const album_detail = @import("../domain/album_detail.zig");
const album_id = @import("../identity/album_id.zig");
const store_module = @import("album_detail_store.zig");
const postgres_list = @import("../projection/postgres_list_store.zig");
const postgres_track = @import("postgres_track_store.zig");
const AlbumDetailStore = store_module.AlbumDetailStore;

pub const PostgresAlbumDetailStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresAlbumDetailStore) AlbumDetailStore {
        return .{ .context = self, .get_by_uri_fn = getOpaque };
    }

    fn getOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.Request,
    ) AlbumDetailStore.Error!?album_detail.AlbumDetail {
        const self: *PostgresAlbumDetailStore = @ptrCast(@alignCast(context));
        return self.getByUri(allocator, request);
    }

    fn getByUri(
        self: *PostgresAlbumDetailStore,
        allocator: std.mem.Allocator,
        request: store_module.Request,
    ) AlbumDetailStore.Error!?album_detail.AlbumDetail {
        var result = self.pool.query(detail_query, .{
            request.uri,
            request.list_collection,
            request.track_collection,
        }) catch |err| {
            std.log.err("verified album detail query failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer result.deinit();

        var record: ?album_detail.Record = null;
        var metadata: album_detail.Metadata = undefined;
        var projection: album_detail.Projection = undefined;
        var id: []const u8 = undefined;
        var members: std.ArrayList(album_detail.Member) = .empty;
        var available_count: usize = 0;
        var total_plays: i64 = 0;

        while (result.next() catch |err| {
            std.log.err("verified album detail read failed: {}", .{err});
            return error.IndexUnavailable;
        }) |row_value| {
            const row = &row_value;
            if (record == null) {
                const decoded = decodeRecord(allocator, row, request) catch |err| switch (err) {
                    error.OutOfMemory => return error.OutOfMemory,
                    else => {
                        std.log.err("verified album record decode failed: {}", .{err});
                        return error.CorruptProjection;
                    },
                };
                record = decoded.record;
                metadata = decoded.metadata;
                projection = decoded.projection;
                id = decoded.id;
            } else if (!std.mem.eql(
                u8,
                record.?.uri,
                row.get([]const u8, 0) catch return error.CorruptProjection,
            )) return error.CorruptProjection;

            const position = row.get(?i16, 11) catch return error.CorruptProjection;
            if (position == null) {
                if (members.items.len != 0 or
                    (row.get(?[]const u8, 12) catch return error.CorruptProjection) != null or
                    (row.get(?[]const u8, 13) catch return error.CorruptProjection) != null)
                    return error.CorruptProjection;
                continue;
            }
            if (position.? < 0 or @as(usize, @intCast(position.?)) != members.items.len)
                return error.CorruptProjection;
            const subject_uri = try duplicate(
                allocator,
                row.get([]const u8, 12) catch return error.CorruptProjection,
            );
            validateTrackUri(subject_uri, request.track_collection) catch
                return error.CorruptProjection;
            const subject_cid = try duplicate(
                allocator,
                row.get([]const u8, 13) catch return error.CorruptProjection,
            );
            validateCid(allocator, subject_cid, zat.cbor.Codec.dag_cbor) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            };

            const joined_track = row.get(?[]const u8, 14) catch
                return error.CorruptProjection;
            const joined_artist = row.get(?[]const u8, 22) catch
                return error.CorruptProjection;
            const resolved = if (joined_track != null and joined_artist != null)
                postgres_track.PostgresTrackStore.decodeRowAt(allocator, row, 14) catch |err| switch (err) {
                    error.OutOfMemory => return error.OutOfMemory,
                    else => return error.CorruptProjection,
                }
            else
                null;
            if (resolved) |track| {
                available_count += 1;
                total_plays = std.math.add(i64, total_plays, track.metrics.play_count) catch
                    return error.CorruptProjection;
            }
            members.append(allocator, .{
                .position = @intCast(position.?),
                .subject = .{ .uri = subject_uri, .cid = subject_cid },
                .availability = if (resolved != null) .available else .unavailable,
                .track = resolved,
            }) catch return error.OutOfMemory;
        }
        const album_record = record orelse return null;
        const member_count = members.items.len;
        const owned_members = members.toOwnedSlice(allocator) catch return error.OutOfMemory;
        return .{
            .id = id,
            .record = album_record,
            .metadata = metadata,
            .members = owned_members,
            .metrics = .{
                .member_count = member_count,
                .available_count = available_count,
                .total_plays = total_plays,
            },
            .projection = projection,
        };
    }
};

const DecodedRecord = struct {
    id: []const u8,
    record: album_detail.Record,
    metadata: album_detail.Metadata,
    projection: album_detail.Projection,
};

fn decodeRecord(
    allocator: std.mem.Allocator,
    row: anytype,
    request: store_module.Request,
) !DecodedRecord {
    const uri = try duplicate(allocator, try row.get([]const u8, 0));
    if (!std.mem.eql(u8, uri, request.uri)) return error.CorruptAlbumUri;
    const parsed = zat.AtUri.parse(uri) orelse return error.CorruptAlbumUri;
    const collection = parsed.collection() orelse return error.CorruptAlbumUri;
    const rkey = parsed.rkey() orelse return error.CorruptAlbumUri;
    const owner_did = try row.get([]const u8, 2);
    if (!std.mem.eql(u8, parsed.authority(), owner_did) or
        !std.mem.eql(u8, collection, request.list_collection) or
        !std.mem.eql(u8, collection, try row.get([]const u8, 3)) or
        !std.mem.eql(u8, rkey, try row.get([]const u8, 4)))
        return error.CorruptAlbumUri;
    const record_cid = try duplicate(allocator, try row.get([]const u8, 1));
    try validateCid(allocator, record_cid, zat.cbor.Codec.dag_cbor);
    const commit_cid = try duplicate(allocator, try row.get([]const u8, 8));
    try validateCid(allocator, commit_cid, zat.cbor.Codec.dag_cbor);
    const commit_rev = try duplicate(allocator, try row.get([]const u8, 9));
    const indexed_at_us = try row.get(i64, 10);
    if (zat.Tid.parse(commit_rev) == null or indexed_at_us < 0)
        return error.CorruptAlbumProof;
    const id = try allocator.alloc(u8, album_id.encodedLength(uri));
    _ = try album_id.encode(id, uri);
    return .{
        .id = id,
        .record = .{
            .uri = uri,
            .cid = record_cid,
            .collection = collection,
            .rkey = rkey,
        },
        .metadata = .{
            .name = try duplicateOptional(allocator, try row.get(?[]const u8, 5)),
            .created_at = try duplicate(allocator, try row.get([]const u8, 6)),
            .updated_at = try duplicateOptional(allocator, try row.get(?[]const u8, 7)),
        },
        .projection = .{
            .commit_cid = commit_cid,
            .commit_rev = commit_rev,
            .indexed_at_us = indexed_at_us,
        },
    };
}

fn validateTrackUri(uri: []const u8, expected_collection: []const u8) !void {
    const parsed = zat.AtUri.parse(uri) orelse return error.CorruptMemberUri;
    if (zat.Did.parse(parsed.authority()) == null or
        parsed.rkey() == null or
        !std.mem.eql(u8, parsed.collection() orelse return error.CorruptMemberUri, expected_collection))
        return error.CorruptMemberUri;
}

fn validateCid(allocator: std.mem.Allocator, value: []const u8, codec: u64) !void {
    const parsed = try zat.Cid.fromString(allocator, value);
    defer allocator.free(parsed.raw);
    if (parsed.codec() != codec) return error.CorruptCid;
}

fn duplicate(allocator: std.mem.Allocator, value: []const u8) ![]const u8 {
    return allocator.dupe(u8, value);
}

fn duplicateOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |present| try duplicate(allocator, present) else null;
}

const detail_query =
    \\SELECT
    \\  records.record_uri,
    \\  records.record_cid,
    \\  records.owner_did,
    \\  records.collection,
    \\  records.rkey,
    \\  records.name,
    \\  records.record_created_at,
    \\  records.record_updated_at,
    \\  records.commit_cid,
    \\  records.commit_rev,
    \\  records.indexed_at_us,
    \\  members.position,
    \\  members.track_uri,
    \\  members.track_cid,
    \\
++ postgres_track.projected_columns ++ "\n" ++
    \\FROM plyr_index.list_records AS records
    \\LEFT JOIN plyr_index.list_members AS members ON members.list_uri = records.record_uri
    \\LEFT JOIN tracks AS t ON t.atproto_record_uri = members.track_uri
    \\  AND t.atproto_record_cid = members.track_cid
    \\  AND split_part(t.atproto_record_uri, '/', 4) = $3
    \\  AND t.visibility <> 'private'
    \\  AND COALESCE(t.publish_state, 'published') = 'published'
    \\  AND t.moderation_override IS DISTINCT FROM 'exclude'
    \\  AND (
    \\    t.moderation_override IS NOT DISTINCT FROM 'allow'
    \\    OR NOT (
    \\      t.self_labels ?| ARRAY['copyright-violation']
    \\      OR t.operator_labels ?| ARRAY['copyright-violation']
    \\    )
    \\  )
    \\LEFT JOIN plyr_index.track_metrics AS tm
    \\  ON tm.record_uri = t.atproto_record_uri
    \\LEFT JOIN artists AS a ON a.did = t.artist_did AND a.deactivated = false
    \\WHERE records.record_uri = $1
    \\  AND records.collection = $2
    \\  AND records.list_type = 'album'
    \\  AND NOT records.deleted
    \\ORDER BY members.position
;

test "PostgreSQL verified album detail preserves unavailable positions" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    var database_row = (try pool.row("SELECT current_database()", .{})).?;
    const database_name = try allocator.dupe(u8, try database_row.get([]const u8, 0));
    defer allocator.free(database_name);
    try database_row.deinit();
    if (!std.mem.eql(u8, database_name, "zig_test")) return error.UnsafeTestDatabase;

    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    _ = try pool.exec("DROP TABLE IF EXISTS tracks CASCADE", .{});
    _ = try pool.exec("DROP TABLE IF EXISTS artists CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    try postgres_list.createTestSchema(pool);
    try createTrackSchema(pool);

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const list_uri = "at://did:plc:artist/fm.plyr.dev.list/album";
    const track_uri = "at://did:plc:artist/fm.plyr.dev.track/track";
    const missing_uri = "at://did:plc:artist/fm.plyr.dev.track/missing";
    const private_uri = "at://did:plc:artist/fm.plyr.dev.track/private";
    const list_cid = try cidString(a, "list");
    const track_cid = try cidString(a, "track");
    const private_cid = try cidString(a, "private");
    const commit_cid = try cidString(a, "commit");
    _ = try pool.exec(
        \\INSERT INTO plyr_index.list_records VALUES (
        \\  $1, $2, 'did:plc:artist', 'fm.plyr.dev.list', 'album', 'album',
        \\  'Album', '2026-08-08T12:00:00Z', NULL, false, $3, '3jqfcqzm3fo2j', 42
        \\)
    , .{ list_uri, list_cid, commit_cid });
    _ = try pool.exec(
        \\INSERT INTO plyr_index.list_members VALUES
        \\  ($1, 0, $2, $3), ($1, 1, $4, $3), ($1, 2, $5, $6)
    , .{ list_uri, track_uri, track_cid, missing_uri, private_uri, private_cid });
    _ = try pool.exec(
        "INSERT INTO artists (did, handle, display_name) VALUES ('did:plc:artist', 'artist.test', 'Artist')",
        .{},
    );
    try insertTrack(pool, track_uri, track_cid, "public", 700);
    try insertTrack(pool, private_uri, private_cid, "private", 11);
    _ = try pool.exec(
        "INSERT INTO plyr_index.track_metrics VALUES ($1, 7, 'legacy_import', 1000)",
        .{track_uri},
    );

    var implementation: PostgresAlbumDetailStore = .{ .pool = pool };
    const detail = (try implementation.store().getByUri(a, .{
        .uri = list_uri,
        .list_collection = "fm.plyr.dev.list",
        .track_collection = "fm.plyr.dev.track",
    })).?;
    try std.testing.expectEqual(@as(usize, 3), detail.members.len);
    try std.testing.expectEqual(@as(usize, 3), detail.metrics.member_count);
    try std.testing.expectEqual(album_detail.Availability.available, detail.members[0].availability);
    try std.testing.expectEqual(album_detail.Availability.unavailable, detail.members[1].availability);
    try std.testing.expectEqual(album_detail.Availability.unavailable, detail.members[2].availability);
    try std.testing.expectEqualStrings(track_uri, detail.members[0].subject.uri);
    try std.testing.expectEqualStrings(track_cid, detail.members[0].subject.cid);
    try std.testing.expectEqualStrings(missing_uri, detail.members[1].subject.uri);
    try std.testing.expectEqual(@as(u16, 2), detail.members[2].position);
    try std.testing.expectEqual(@as(usize, 1), detail.metrics.available_count);
    try std.testing.expectEqual(@as(i64, 7), detail.metrics.total_plays);

    _ = try pool.exec(
        "DELETE FROM plyr_index.list_members WHERE list_uri = $1 AND position = 1",
        .{list_uri},
    );
    try std.testing.expectError(error.CorruptProjection, implementation.store().getByUri(a, .{
        .uri = list_uri,
        .list_collection = "fm.plyr.dev.list",
        .track_collection = "fm.plyr.dev.track",
    }));
}

fn cidString(allocator: std.mem.Allocator, seed: []const u8) ![]const u8 {
    const cid = try zat.Cid.forDagCbor(allocator, seed);
    return cid.toString(allocator);
}

fn createTrackSchema(pool: *pg.Pool) !void {
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.track_metrics (
        \\  record_uri text PRIMARY KEY, play_count bigint NOT NULL,
        \\  write_source text NOT NULL, observed_at_us bigint NOT NULL
        \\)
    , .{});
    _ = try pool.exec(
        \\CREATE TABLE artists (
        \\  did text PRIMARY KEY, handle text NOT NULL, display_name text NOT NULL,
        \\  avatar_url text, deactivated boolean NOT NULL DEFAULT false
        \\)
    , .{});
    _ = try pool.exec(
        \\CREATE TABLE tracks (
        \\  atproto_record_uri text PRIMARY KEY, atproto_record_cid text,
        \\  atproto_record_rev text, title text NOT NULL, description text,
        \\  extra jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL,
        \\  artist_did text NOT NULL, pds_blob_cid text, pds_blob_size integer,
        \\  r2_url text, file_type text NOT NULL, visibility text NOT NULL,
        \\  support_gate jsonb, space_uri text, self_labels jsonb NOT NULL DEFAULT '[]',
        \\  operator_labels jsonb NOT NULL DEFAULT '[]', moderation_override text,
        \\  play_count integer NOT NULL DEFAULT 0, publish_state text
        \\)
    , .{});
}

fn insertTrack(
    pool: *pg.Pool,
    uri: []const u8,
    cid: []const u8,
    visibility: []const u8,
    plays: i32,
) !void {
    _ = try pool.exec(
        \\INSERT INTO tracks (
        \\  atproto_record_uri, atproto_record_cid, atproto_record_rev, title,
        \\  created_at, artist_did, file_type, visibility, play_count, publish_state
        \\) VALUES ($1, $2, '3jqfcqzm3fo2j', 'Track', '2026-08-08T12:00:00Z',
        \\  'did:plc:artist', 'audio/mpeg', $3, $4, 'published')
    , .{ uri, cid, visibility, plays });
}
