//! PostgreSQL adapter for verified-catalog keyword search.
//!
//! The application depends on `SearchStore`, not this schema. PostgreSQL is a
//! rebuildable candidate/ranking engine over authenticated record projections;
//! it never becomes the authority for the returned music metadata.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const lexicon_value = @import("../atproto/lexicon_value.zig");
const domain = @import("../domain/search.zig");
const track = @import("../domain/track.zig");
const track_id = @import("../identity/track_id.zig");
const album_id = @import("../identity/album_id.zig");
const playlist_id = @import("../identity/playlist_id.zig");
const store_module = @import("search_store.zig");
const SearchStore = store_module.SearchStore;

pub const PostgresSearchStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresSearchStore) SearchStore {
        return .{ .context = self, .search_fn = searchOpaque };
    }

    fn searchOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.Request,
    ) SearchStore.Error![]domain.Hit {
        const self: *PostgresSearchStore = @ptrCast(@alignCast(context));
        return self.search(allocator, request);
    }

    fn search(
        self: *PostgresSearchStore,
        allocator: std.mem.Allocator,
        request: store_module.Request,
    ) SearchStore.Error![]domain.Hit {
        const conn = self.pool.acquire() catch |err| {
            std.log.err("search connection failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer self.pool.release(conn);
        var result = conn.query(search_query, .{
            request.query,
            request.track_collection,
            request.list_collection,
            request.profile_collection,
            request.types.track,
            request.types.artist,
            request.types.album,
            request.types.playlist,
            @as(i64, @intCast(request.limit)),
        }) catch |err| {
            if (conn.err) |pg_err|
                std.log.err("search query failed: {}: {s}", .{ err, pg_err.message })
            else
                std.log.err("search query failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer result.deinit();

        var hits: std.ArrayList(domain.Hit) = .empty;
        errdefer hits.deinit(allocator);
        while (result.next() catch |err| {
            std.log.err("search result read failed: {}", .{err});
            return error.IndexUnavailable;
        }) |row| {
            const hit = decodeRow(allocator, row, request) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => {
                    std.log.err("search projection decode failed: {}", .{err});
                    return error.CorruptProjection;
                },
            };
            hits.append(allocator, hit) catch return error.OutOfMemory;
        }
        return hits.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }
};

fn decodeRow(
    allocator: std.mem.Allocator,
    row: anytype,
    request: store_module.Request,
) !domain.Hit {
    const kind = try parseEnum(domain.Kind, try row.get([]const u8, 0));
    if (!enabled(request.types, kind)) return error.DisabledKindReturned;
    const record_uri = try duplicate(allocator, try row.get([]const u8, 1));
    const parsed_uri = zat.AtUri.parse(record_uri) orelse return error.CorruptRecordUri;
    const expected_collection = switch (kind) {
        .track => request.track_collection,
        .artist => request.profile_collection,
        .album, .playlist => request.list_collection,
    };
    if (!std.mem.eql(u8, parsed_uri.collection() orelse return error.CorruptRecordUri, expected_collection) or
        parsed_uri.rkey() == null) return error.CorruptRecordUri;
    if (kind == .artist and !std.mem.eql(u8, parsed_uri.rkey().?, "self"))
        return error.CorruptRecordUri;

    const owner_did = try duplicate(allocator, try row.get([]const u8, 4));
    if (zat.Did.parse(owner_did) == null or !std.mem.eql(u8, parsed_uri.authority(), owner_did))
        return error.CorruptOwnerDid;
    const record_cid = try duplicate(allocator, try row.get([]const u8, 2));
    try validateCid(allocator, record_cid);
    const title = try duplicate(allocator, try row.get([]const u8, 3));
    if (title.len == 0 or !std.unicode.utf8ValidateSlice(title)) return error.CorruptTitle;
    const handle = try duplicate(allocator, try row.get([]const u8, 5));
    if (zat.Handle.parse(handle) == null) return error.CorruptHandle;
    const display_name = try duplicate(allocator, try row.get([]const u8, 6));
    if (!std.unicode.utf8ValidateSlice(display_name)) return error.CorruptDisplayName;
    const image_url = try duplicateOptional(allocator, try row.get(?[]const u8, 7));
    if (image_url) |value| if (!lexicon_value.validUri(value)) return error.CorruptImage;

    const play_count = try row.get(?i64, 8);
    const member_count_raw = try row.get(?i64, 9);
    if (play_count) |value| if (value < 0) return error.CorruptMetrics;
    const member_count = if (member_count_raw) |value|
        try nonnegativeUsize(value)
    else
        null;
    switch (kind) {
        .track => if (play_count == null or member_count != null) return error.CorruptMetrics,
        .artist => if (play_count != null or member_count != null) return error.CorruptMetrics,
        .album, .playlist => if (play_count != null or member_count == null) return error.CorruptMetrics,
    }

    const indexed_at_us = try row.get(i64, 10);
    if (indexed_at_us < 0) return error.CorruptProjection;
    const authored_image = try row.get(bool, 11);
    if (authored_image and image_url == null) return error.CorruptImage;
    const has_metrics = try row.get(bool, 12);
    if (kind != .track and has_metrics) return error.CorruptMetrics;
    const account_source = try parseAccountSource(try row.get([]const u8, 13));
    const match_field = try parseEnum(domain.MatchField, try row.get([]const u8, 14));
    const match_kind = try parseEnum(domain.MatchKind, try row.get([]const u8, 15));

    const id = switch (kind) {
        .artist => try duplicate(allocator, owner_did),
        .track => try encodeRecordId(allocator, track_id, record_uri),
        .album => try encodeRecordId(allocator, album_id, record_uri),
        .playlist => try encodeRecordId(allocator, playlist_id, record_uri),
    };
    const artist_text_source: track.Source = if (kind == .artist) .legacy_local else .verified_repo;
    const owner_display_source: track.Source = if (kind == .artist) .legacy_local else .legacy_projection;
    const image_source: track.Source = if (image_url == null)
        .derived
    else if (authored_image)
        .authored_profile
    else
        .legacy_projection;
    const metric_source: track.Source = if (kind == .track and has_metrics)
        .application_metrics
    else
        .derived;
    return .{
        .type = kind,
        .id = id,
        .record = .{ .uri = record_uri, .cid = record_cid },
        .title = title,
        .owner = .{
            .did = owner_did,
            .handle = handle,
            .display_name = display_name,
        },
        .image_url = image_url,
        .metrics = .{ .play_count = play_count, .member_count = member_count },
        .match = .{ .kind = match_kind, .field = match_field },
        .sources = .{
            .title = artist_text_source,
            .owner_handle = .legacy_projection,
            .owner_display_name = owner_display_source,
            .image = image_source,
            .metrics = metric_source,
            .account_availability = account_source,
        },
        .projection = .{ .indexed_at_us = indexed_at_us },
    };
}

fn enabled(types: store_module.Types, kind: domain.Kind) bool {
    return switch (kind) {
        .track => types.track,
        .artist => types.artist,
        .album => types.album,
        .playlist => types.playlist,
    };
}

fn encodeRecordId(
    allocator: std.mem.Allocator,
    comptime codec: type,
    record_uri: []const u8,
) ![]const u8 {
    const destination = try allocator.alloc(u8, codec.encodedLength(record_uri));
    return codec.encode(destination, record_uri);
}

fn parseEnum(comptime T: type, value: []const u8) !T {
    inline for (@typeInfo(T).@"enum".fields) |field| {
        if (std.mem.eql(u8, value, field.name)) return @enumFromInt(field.value);
    }
    return error.UnknownEnumValue;
}

fn parseAccountSource(value: []const u8) !track.Source {
    if (std.mem.eql(u8, value, "verified_repository")) return .verified_repo;
    if (std.mem.eql(u8, value, "current_pds")) return .current_pds;
    return error.CorruptAccountSource;
}

fn nonnegativeUsize(value: i64) !usize {
    if (value < 0) return error.CorruptMetrics;
    return std.math.cast(usize, value) orelse error.CorruptMetrics;
}

fn validateCid(allocator: std.mem.Allocator, value: []const u8) !void {
    const parsed = try zat.Cid.fromString(allocator, value);
    defer allocator.free(parsed.raw);
    if (parsed.codec() != zat.cbor.Codec.dag_cbor) return error.CorruptCid;
}

fn duplicate(allocator: std.mem.Allocator, value: []const u8) ![]const u8 {
    return allocator.dupe(u8, value);
}

fn duplicateOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |present| try duplicate(allocator, present) else null;
}

const search_query =
    \\WITH candidates AS (
    \\  SELECT
    \\    'track'::text AS entity_type,
    \\    v.record_uri,
    \\    v.record_cid,
    \\    v.title AS primary_text,
    \\    v.owner_did,
    \\    lower(a.handle) AS owner_handle,
    \\    a.display_name AS owner_display_name,
    \\    NULL::text AS image_url,
    \\    COALESCE(metrics.play_count, 0)::bigint AS play_count,
    \\    NULL::bigint AS member_count,
    \\    v.indexed_at_us,
    \\    false AS authored_image,
    \\    metrics.record_uri IS NOT NULL AS has_metrics,
    \\    aa.evidence_source AS account_source,
    \\    v.title AS match_a,
    \\    'title'::text AS match_a_field,
    \\    NULL::text AS match_b,
    \\    NULL::text AS match_b_field
    \\  FROM plyr_index.track_records AS v
    \\  JOIN plyr_index.account_availability AS aa
    \\    ON aa.repo_did = v.owner_did AND aa.available
    \\  JOIN artists AS a ON a.did = v.owner_did AND NOT a.deactivated
    \\  LEFT JOIN plyr_index.track_policies AS pol ON pol.record_uri = v.record_uri
    \\  LEFT JOIN plyr_index.track_metrics AS metrics ON metrics.record_uri = v.record_uri
    \\  WHERE $5::boolean AND v.collection = $2 AND NOT v.deleted
    \\    AND COALESCE(pol.visibility, 'public') IN ('public', 'supporters')
    \\    AND pol.moderation_decision IS DISTINCT FROM 'exclude'
    \\    AND (
    \\      pol.moderation_decision IS NOT DISTINCT FROM 'allow'
    \\      OR NOT (
    \\        v.self_labels && ARRAY['copyright-violation']::text[]
    \\        OR COALESCE(pol.operator_labels, '[]'::jsonb) ?| ARRAY['copyright-violation']
    \\      )
    \\    )
    \\    AND NOT (
    \\      v.self_labels && ARRAY['sexual', 'porn']::text[]
    \\      OR COALESCE(pol.operator_labels, '[]'::jsonb) ?| ARRAY['sexual', 'porn']
    \\    )
    \\    AND (
    \\      v.title ILIKE '%' || replace(replace(replace($1, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
    \\      OR v.title % $1
    \\    )
    \\  UNION ALL
    \\  SELECT
    \\    'artist'::text,
    \\    p.record_uri,
    \\    p.record_cid,
    \\    a.display_name,
    \\    p.owner_did,
    \\    lower(a.handle),
    \\    a.display_name,
    \\    COALESCE(p.avatar, a.avatar_url),
    \\    NULL::bigint,
    \\    NULL::bigint,
    \\    p.indexed_at_us,
    \\    p.avatar IS NOT NULL,
    \\    false,
    \\    aa.evidence_source,
    \\    lower(a.handle),
    \\    'handle'::text,
    \\    a.display_name,
    \\    'display_name'::text
    \\  FROM plyr_index.profile_records AS p
    \\  JOIN plyr_index.account_availability AS aa
    \\    ON aa.repo_did = p.owner_did AND aa.available
    \\  JOIN artists AS a ON a.did = p.owner_did AND NOT a.deactivated
    \\  WHERE $6::boolean AND p.collection = $4 AND p.rkey = 'self' AND NOT p.deleted
    \\    AND (
    \\      a.handle ILIKE '%' || replace(replace(replace($1, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
    \\      OR a.display_name ILIKE '%' || replace(replace(replace($1, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
    \\      OR a.handle % $1 OR a.display_name % $1
    \\    )
    \\  UNION ALL
    \\  SELECT
    \\    records.list_type,
    \\    records.record_uri,
    \\    records.record_cid,
    \\    records.name,
    \\    records.owner_did,
    \\    lower(a.handle),
    \\    a.display_name,
    \\    NULL::text,
    \\    NULL::bigint,
    \\    (SELECT count(*) FROM plyr_index.list_members AS m
    \\      WHERE m.list_uri = records.record_uri)::bigint,
    \\    records.indexed_at_us,
    \\    false,
    \\    false,
    \\    aa.evidence_source,
    \\    records.name,
    \\    'name'::text,
    \\    NULL::text,
    \\    NULL::text
    \\  FROM plyr_index.list_records AS records
    \\  JOIN plyr_index.account_availability AS aa
    \\    ON aa.repo_did = records.owner_did AND aa.available
    \\  JOIN artists AS a ON a.did = records.owner_did AND NOT a.deactivated
    \\  WHERE records.collection = $3 AND NOT records.deleted AND records.name IS NOT NULL
    \\    AND ((records.list_type = 'album' AND $7::boolean)
    \\      OR (records.list_type = 'playlist' AND $8::boolean))
    \\    AND (
    \\      records.name ILIKE '%' || replace(replace(replace($1, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
    \\      OR records.name % $1
    \\    )
    \\), scored AS (
    \\  SELECT candidates.*,
    \\    CASE
    \\      WHEN lower(match_a) = lower($1) THEN CASE WHEN match_a_field = 'handle' THEN 5 ELSE 4 END
    \\      WHEN left(lower(match_a), length(lower($1))) = lower($1) THEN 3
    \\      WHEN strpos(lower(match_a), lower($1)) > 0 THEN 2
    \\      WHEN match_a % $1 THEN 1
    \\      ELSE 0
    \\    END AS a_tier,
    \\    COALESCE(similarity(lower(match_a), lower($1)), 0) AS a_similarity,
    \\    CASE
    \\      WHEN lower(match_b) = lower($1) THEN 4
    \\      WHEN left(lower(match_b), length(lower($1))) = lower($1) THEN 3
    \\      WHEN strpos(lower(match_b), lower($1)) > 0 THEN 2
    \\      WHEN match_b % $1 THEN 1
    \\      ELSE 0
    \\    END AS b_tier,
    \\    COALESCE(similarity(lower(match_b), lower($1)), 0) AS b_similarity
    \\  FROM candidates
    \\), ranked AS (
    \\  SELECT scored.*,
    \\    GREATEST(a_tier, b_tier) AS match_tier,
    \\    GREATEST(a_similarity, b_similarity) AS lexical_similarity,
    \\    CASE WHEN a_tier > b_tier OR (a_tier = b_tier AND a_similarity >= b_similarity)
    \\      THEN match_a_field ELSE match_b_field END AS matched_field
    \\  FROM scored
    \\)
    \\SELECT
    \\  entity_type,
    \\  record_uri,
    \\  record_cid,
    \\  primary_text,
    \\  owner_did,
    \\  owner_handle,
    \\  owner_display_name,
    \\  image_url,
    \\  play_count,
    \\  member_count,
    \\  indexed_at_us,
    \\  authored_image,
    \\  has_metrics,
    \\  account_source,
    \\  matched_field,
    \\  CASE match_tier
    \\    WHEN 5 THEN 'exact'
    \\    WHEN 4 THEN 'exact'
    \\    WHEN 3 THEN 'prefix'
    \\    WHEN 2 THEN 'substring'
    \\    ELSE 'fuzzy'
    \\  END AS match_kind
    \\FROM ranked
    \\WHERE match_tier > 0
    \\ORDER BY match_tier DESC, lexical_similarity DESC,
    \\  lower(primary_text), entity_type, record_uri
    \\LIMIT $9::bigint
;
