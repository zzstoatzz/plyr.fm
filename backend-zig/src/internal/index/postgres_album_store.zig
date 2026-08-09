//! PostgreSQL adapter for canonical public album-list summaries.
//!
//! The adapter borrows the catalog pool. Legacy presentation and relationship
//! columns remain transitional inputs, but a summary is emitted only when the
//! same album URI and CID exist in the authenticated list projection. This
//! keeps collection and detail reads closed over one verified record set.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const album = @import("../domain/album.zig");
const album_id = @import("../identity/album_id.zig");
const album_index = @import("album_store.zig");
const AlbumStore = album_index.AlbumStore;

pub const PostgresAlbumStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresAlbumStore) AlbumStore {
        return .{ .context = self, .list_by_artist_fn = listOpaque };
    }

    fn listOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: album_index.ListRequest,
    ) AlbumStore.Error![]album_index.ListItem {
        const self: *PostgresAlbumStore = @ptrCast(@alignCast(context));
        return self.listByArtist(allocator, request);
    }

    fn listByArtist(
        self: *PostgresAlbumStore,
        allocator: std.mem.Allocator,
        request: album_index.ListRequest,
    ) AlbumStore.Error![]album_index.ListItem {
        const limit: i64 = @intCast(request.limit);
        var result = if (request.after) |after|
            self.pool.query(list_after_query, .{
                request.collection,
                request.artist_did,
                after.created_at_us,
                after.at_uri,
                limit,
            }) catch |err| {
                std.log.err("PostgreSQL artist album collection query failed: {}", .{err});
                return error.IndexUnavailable;
            }
        else
            self.pool.query(list_query, .{
                request.collection,
                request.artist_did,
                limit,
            }) catch |err| {
                std.log.err("PostgreSQL artist album collection query failed: {}", .{err});
                return error.IndexUnavailable;
            };
        defer result.deinit();

        var items: std.ArrayListUnmanaged(album_index.ListItem) = .empty;
        errdefer items.deinit(allocator);
        while (result.next() catch |err| {
            std.log.err("PostgreSQL artist album collection read failed: {}", .{err});
            return error.IndexUnavailable;
        }) |row_value| {
            const row = &row_value;
            const value = decodeRow(allocator, row) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => {
                    std.log.err("album projection decode failed: {}", .{err});
                    return error.CorruptProjection;
                },
            };
            const created_at_us = row.get(i64, 13) catch |err| {
                std.log.err("album collection sort key decode failed: {}", .{err});
                return error.CorruptProjection;
            };
            items.append(allocator, .{ .value = value, .created_at_us = created_at_us }) catch
                return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }

    fn decodeRow(allocator: std.mem.Allocator, row: anytype) !album.Album {
        const uri = try duplicate(allocator, try row.get([]const u8, 0));
        const parsed_uri = zat.AtUri.parse(uri) orelse return error.CorruptAlbumUri;
        const collection = parsed_uri.collection() orelse return error.CorruptAlbumUri;
        const rkey = parsed_uri.rkey() orelse return error.CorruptAlbumUri;
        const artist_did = try duplicate(allocator, try row.get([]const u8, 8));
        if (!std.mem.eql(u8, parsed_uri.authority(), artist_did))
            return error.CorruptAlbumAuthority;

        const cid = try duplicate(allocator, try row.get([]const u8, 1));
        const parsed_cid = try zat.Cid.fromString(allocator, cid);
        defer allocator.free(parsed_cid.raw);
        if (parsed_cid.codec() != zat.cbor.Codec.dag_cbor)
            return error.CorruptAlbumCid;

        const id = try allocator.alloc(u8, album_id.encodedLength(uri));
        _ = try album_id.encode(id, uri);

        return .{
            .id = id,
            .record = .{
                .uri = uri,
                .cid = cid,
                .collection = collection,
                .rkey = rkey,
            },
            .metadata = .{
                .name = try duplicate(allocator, try row.get([]const u8, 2)),
                .created_at = try duplicate(allocator, try row.get([]const u8, 6)),
                .updated_at = try duplicate(allocator, try row.get([]const u8, 7)),
            },
            .presentation = .{
                .slug = try duplicate(allocator, try row.get([]const u8, 3)),
                .description = try duplicateOptional(allocator, try row.get(?[]const u8, 4)),
                .artwork_url = try duplicateOptional(allocator, try row.get(?[]const u8, 5)),
            },
            .artist = .{
                .did = artist_did,
                .handle = try duplicate(allocator, try row.get([]const u8, 9)),
                .display_name = try duplicate(allocator, try row.get([]const u8, 10)),
            },
            .metrics = .{
                .track_count = try row.get(i64, 11),
                .total_plays = try row.get(i64, 12),
            },
            .sources = .{
                .metadata = .legacy_projection,
                .presentation = .legacy_local,
                .membership = .legacy_local,
                .metrics = .derived,
            },
            .projection = .{ .indexed_at = null, .verification = .legacy_unverified },
        };
    }
};

const select_and_join =
    \\SELECT
    \\  al.atproto_record_uri,
    \\  al.atproto_record_cid,
    \\  al.title,
    \\  al.slug,
    \\  al.description,
    \\  al.image_url,
    \\  to_char(al.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    \\  to_char(al.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    \\  a.did,
    \\  a.handle,
    \\  a.display_name,
    \\  count(t.atproto_record_uri)::bigint,
    \\  COALESCE(sum(metrics.play_count), 0)::bigint,
    \\  (extract(epoch FROM al.created_at) * 1000000)::bigint
    \\FROM albums AS al
    \\JOIN plyr_index.list_records AS verified_list
    \\  ON verified_list.record_uri = al.atproto_record_uri
    \\  AND verified_list.record_cid = al.atproto_record_cid
    \\  AND verified_list.list_type = 'album'
    \\  AND NOT verified_list.deleted
    \\JOIN artists AS a ON a.did = al.artist_did
    \\LEFT JOIN tracks AS t ON t.album_id = al.id
    \\  AND t.atproto_record_uri IS NOT NULL
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
    \\LEFT JOIN plyr_index.track_metrics AS metrics
    \\  ON metrics.record_uri = t.atproto_record_uri
;

const where_policy =
    \\WHERE al.artist_did = $2
    \\  AND al.atproto_record_uri IS NOT NULL
    \\  AND al.atproto_record_cid IS NOT NULL
    \\  AND split_part(al.atproto_record_uri, '/', 4) = $1
    \\  AND a.deactivated = false
;

const grouping =
    \\GROUP BY al.id, a.did
    \\HAVING count(t.atproto_record_uri) > 0
;

const list_query = select_and_join ++ "\n" ++ where_policy ++ "\n" ++ grouping ++ "\n" ++
    \\ORDER BY al.created_at DESC, al.atproto_record_uri DESC
    \\LIMIT $3::bigint
;

const list_after_query = select_and_join ++ "\n" ++ where_policy ++
    \\  AND (
    \\    al.created_at < TIMESTAMPTZ 'epoch' + ($3::bigint * INTERVAL '1 microsecond')
    \\    OR (
    \\      al.created_at = TIMESTAMPTZ 'epoch' + ($3::bigint * INTERVAL '1 microsecond')
    \\      AND al.atproto_record_uri < $4
    \\    )
    \\  )
    \\GROUP BY al.id, a.did
    \\HAVING count(t.atproto_record_uri) > 0
    \\ORDER BY al.created_at DESC, al.atproto_record_uri DESC
    \\LIMIT $5::bigint
;

fn duplicate(allocator: std.mem.Allocator, value: []const u8) ![]const u8 {
    return allocator.dupe(u8, value);
}

fn duplicateOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |present| try duplicate(allocator, present) else null;
}
