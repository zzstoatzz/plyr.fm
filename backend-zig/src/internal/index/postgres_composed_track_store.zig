//! Transitional REST adapter composed from independently attributed sources.
//!
//! Authenticated repository rows own record metadata, blob declarations, and
//! self-labels. Account evidence owns visibility of the repository. Existing
//! App-owned access and operator-moderation claims share a canonical-URI policy
//! projection while retaining independent provenance. Existing app tables still
//! supply mutable handles, counters, and unverified R2 delivery until those
//! projections are replaced.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const lexicon_value = @import("../atproto/lexicon_value.zig");
const track = @import("../domain/track.zig");
const verified_list = @import("../domain/verified_list.zig");
const track_id = @import("../identity/track_id.zig");
const store_module = @import("track_store.zig");

const TrackStore = store_module.TrackStore;

pub const PostgresComposedTrackStore = struct {
    pool: *pg.Pool,
    profile_collection: []const u8,
    like_collection: []const u8,

    pub fn store(self: *PostgresComposedTrackStore) TrackStore {
        return .{
            .context = self,
            .get_by_uri_fn = getByUriOpaque,
            .list_public_fn = listPublicOpaque,
            .ready_fn = readyOpaque,
        };
    }

    fn readyOpaque(context: *anyopaque) bool {
        const self: *PostgresComposedTrackStore = @ptrCast(@alignCast(context));
        var row = self.pool.row(readiness_sql, .{}) catch |err| {
            std.log.err("composed track readiness failed: {}", .{err});
            return false;
        } orelse return false;
        finishQueryRow(&row) catch |err| {
            std.log.err("composed track readiness cleanup failed: {}", .{err});
            return false;
        };
        return true;
    }

    fn getByUriOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        at_uri: []const u8,
    ) TrackStore.Error!?track.Track {
        const self: *PostgresComposedTrackStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch |err| {
            std.log.err("composed track connection failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer self.pool.release(conn);
        var query_row = conn.row(detail_query, .{
            at_uri,
            self.profile_collection,
            self.like_collection,
        }) catch |err| {
            if (conn.err) |pg_err|
                std.log.err("composed track lookup failed: {}: {s}", .{ err, pg_err.message })
            else
                std.log.err("composed track lookup failed: {}", .{err});
            return error.IndexUnavailable;
        } orelse return null;
        var active = true;
        defer if (active) forceReleaseQueryRow(&query_row);
        const value = decodeRow(allocator, &query_row.row) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => {
                std.log.err("composed track decode failed: {}", .{err});
                return error.CorruptProjection;
            },
        };
        finishQueryRow(&query_row) catch |err| {
            std.log.err("composed track result cleanup failed: {}", .{err});
            active = false;
            return error.IndexUnavailable;
        };
        active = false;
        return value;
    }

    fn listPublicOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.ListRequest,
    ) TrackStore.Error![]store_module.ListItem {
        const self: *PostgresComposedTrackStore = @ptrCast(@alignCast(context));
        const limit: i64 = @intCast(request.limit);
        const conn = self.pool.acquire() catch |err| {
            std.log.err("composed track connection failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer self.pool.release(conn);
        var result = switch (request.scope) {
            .discovery => if (request.after) |after|
                conn.query(discovery_after_query, .{
                    request.collection,
                    self.profile_collection,
                    self.like_collection,
                    after.created_at_us,
                    after.at_uri,
                    limit,
                }) catch |err| {
                    logQueryError(conn, "composed discovery query failed", err);
                    return error.IndexUnavailable;
                }
            else
                conn.query(discovery_query, .{
                    request.collection,
                    self.profile_collection,
                    self.like_collection,
                    limit,
                }) catch |err| {
                    logQueryError(conn, "composed discovery query failed", err);
                    return error.IndexUnavailable;
                },
            .artist => |artist_did| if (request.after) |after|
                conn.query(artist_after_query, .{
                    request.collection,
                    self.profile_collection,
                    self.like_collection,
                    artist_did,
                    after.created_at_us,
                    after.at_uri,
                    limit,
                }) catch |err| {
                    logQueryError(conn, "composed artist catalogue query failed", err);
                    return error.IndexUnavailable;
                }
            else
                conn.query(artist_query, .{
                    request.collection,
                    self.profile_collection,
                    self.like_collection,
                    artist_did,
                    limit,
                }) catch |err| {
                    logQueryError(conn, "composed artist catalogue query failed", err);
                    return error.IndexUnavailable;
                },
        };
        defer result.deinit();
        var items: std.ArrayList(store_module.ListItem) = .empty;
        errdefer items.deinit(allocator);
        while (result.next() catch |err| {
            std.log.err("composed track collection read failed: {}", .{err});
            return error.IndexUnavailable;
        }) |row| {
            const value = decodeRow(allocator, row) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => {
                    std.log.err("composed track collection decode failed: {}", .{err});
                    return error.CorruptProjection;
                },
            };
            items.append(allocator, .{
                .value = value,
                .created_at_us = row.get(i64, 36) catch
                    return error.CorruptProjection,
            }) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }
};

fn logQueryError(conn: *pg.Conn, message: []const u8, err: anyerror) void {
    if (conn.err) |pg_err|
        std.log.err("{s}: {}: {s}", .{ message, err, pg_err.message })
    else
        std.log.err("{s}: {}", .{ message, err });
}

/// Decode the composed projection from a result whose first column is the
/// first field in `projected_columns`. Verified list hydration reuses this
/// exact decoder so standalone and member reads cannot drift semantically.
pub fn decodeRow(allocator: std.mem.Allocator, row: anytype) !track.Track {
    const uri = try duplicate(allocator, try row.get([]const u8, 0));
    const parsed_uri = zat.AtUri.parse(uri) orelse return error.CorruptTrackUri;
    const owner_did = try duplicate(allocator, try row.get([]const u8, 18));
    const collection = try duplicate(allocator, try row.get([]const u8, 3));
    const rkey = try duplicate(allocator, try row.get([]const u8, 4));
    if (!std.mem.eql(u8, parsed_uri.authority(), owner_did) or
        !std.mem.eql(u8, parsed_uri.collection() orelse return error.CorruptTrackUri, collection) or
        !std.mem.eql(u8, parsed_uri.rkey() orelse return error.CorruptTrackUri, rkey))
        return error.CorruptTrackUri;

    const record_cid = try duplicate(allocator, try row.get([]const u8, 1));
    const parsed_record_cid = zat.Cid.fromString(allocator, record_cid) catch
        return error.CorruptRecordCid;
    defer allocator.free(parsed_record_cid.raw);
    if (parsed_record_cid.codec() != zat.cbor.Codec.dag_cbor)
        return error.CorruptRecordCid;
    const commit_rev = try duplicate(allocator, try row.get([]const u8, 2));
    if (zat.Tid.parse(commit_rev) == null) return error.CorruptRevision;

    const id = try allocator.alloc(u8, track_id.encodedLength(uri));
    _ = try track_id.encode(id, uri);
    const blob_cid = try duplicateOptional(allocator, try row.get(?[]const u8, 11));
    const delivery_url = try duplicateOptional(allocator, try row.get(?[]const u8, 37));
    if (delivery_url) |url| {
        if (!lexicon_value.validUri(url)) return error.CorruptOrigin;
    }
    const delivery_artifact_cid = try duplicateOptional(
        allocator,
        try row.get(?[]const u8, 39),
    );
    if (delivery_artifact_cid) |cid| {
        const parsed = zat.Cid.fromString(allocator, cid) catch
            return error.CorruptArtifactCid;
        defer allocator.free(parsed.raw);
        if (parsed.codec() != zat.cbor.Codec.raw) return error.CorruptArtifactCid;
        if (blob_cid == null or !std.mem.eql(u8, blob_cid.?, cid))
            return error.CorruptOrigin;
    }
    const artifacts = if (blob_cid) |cid| blk: {
        const parsed = zat.Cid.fromString(allocator, cid) catch
            return error.CorruptArtifactCid;
        defer allocator.free(parsed.raw);
        if (parsed.codec() != zat.cbor.Codec.raw) return error.CorruptArtifactCid;
        const values = try allocator.alloc(track.Artifact, 1);
        values[0] = .{
            .cid = cid,
            .byte_length = try row.get(?i64, 13),
            .media_type = try duplicate(allocator, (try row.get(?[]const u8, 12)) orelse
                return error.CorruptArtifact),
            .declared_by = uri,
            .verification = if (delivery_artifact_cid != null) .verified else .declared,
        };
        break :blk values;
    } else &.{};

    const authored_url = try duplicateOptional(allocator, try row.get(?[]const u8, 14));
    if (authored_url) |url| {
        if (!lexicon_value.validUri(url)) return error.CorruptOrigin;
    }
    const legacy_url = try duplicateOptional(allocator, try row.get(?[]const u8, 25));
    if (legacy_url) |url| {
        if (!lexicon_value.validUri(url)) return error.CorruptOrigin;
    }
    const delivery_is_authored = delivery_url != null and authored_url != null and
        std.mem.eql(u8, delivery_url.?, authored_url.?);
    const include_delivery = delivery_url != null and !delivery_is_authored;
    const legacy_is_authored = legacy_url != null and authored_url != null and
        std.mem.eql(u8, legacy_url.?, authored_url.?);
    const legacy_is_delivery = legacy_url != null and delivery_url != null and
        std.mem.eql(u8, legacy_url.?, delivery_url.?);
    const has_legacy_fallback = legacy_url != null and
        !legacy_is_authored and !legacy_is_delivery;
    const origin_count = @as(usize, @intFromBool(authored_url != null)) +
        @as(usize, @intFromBool(include_delivery)) +
        @as(usize, @intFromBool(has_legacy_fallback));
    const origins = try allocator.alloc(track.Origin, origin_count);
    var origin_index: usize = 0;
    if (authored_url) |url| {
        origins[origin_index] = .{
            .url = url,
            .media_type = try duplicate(allocator, try row.get([]const u8, 15)),
            .artifact_cid = if (delivery_is_authored) delivery_artifact_cid else null,
            .attestation = null,
            .source = if (delivery_is_authored) .mixed else .verified_repo,
        };
        origin_index += 1;
    }
    if (include_delivery) {
        const url = delivery_url.?;
        origins[origin_index] = .{
            .url = url,
            .media_type = try duplicate(allocator, (try row.get(?[]const u8, 38)) orelse
                return error.CorruptOrigin),
            .artifact_cid = delivery_artifact_cid,
            .attestation = null,
            .source = .verified_delivery,
        };
        origin_index += 1;
    }
    if (has_legacy_fallback) {
        const url = legacy_url.?;
        origins[origin_index] = .{
            .url = url,
            .media_type = try duplicate(allocator, try row.get([]const u8, 26)),
            .artifact_cid = null,
            .attestation = null,
            .source = .legacy_projection,
        };
    }

    const authored_avatar = try row.get(bool, 22);
    const authored_bio = try row.get(bool, 24);
    const availability_source = try parseSource(try row.get([]const u8, 34));
    const has_legacy_track = try row.get(bool, 35);
    const has_access_policy = try row.get(bool, 41);
    const has_moderation_policy = try row.get(bool, 42);
    const has_metrics = try row.get(bool, 43);
    return .{
        .id = id,
        .record = .{
            .uri = uri,
            .cid = record_cid,
            .revision = commit_rev,
            .collection = collection,
            .rkey = rkey,
        },
        .metadata = .{
            .title = try duplicate(allocator, try row.get([]const u8, 5)),
            .artist_name = try duplicateOptional(allocator, try row.get(?[]const u8, 6)),
            .description = try duplicateOptional(allocator, try row.get(?[]const u8, 7)),
            .album = try duplicateOptional(allocator, try row.get(?[]const u8, 8)),
            .duration_seconds = try row.get(?i64, 9),
            .created_at = try duplicate(allocator, try row.get([]const u8, 10)),
        },
        .artist = .{
            .did = owner_did,
            .profile = .{
                .handle = try duplicate(allocator, try row.get([]const u8, 19)),
                .display_name = try duplicate(allocator, try row.get([]const u8, 20)),
                .avatar_url = try duplicateOptional(allocator, try row.get(?[]const u8, 21)),
                .bio = try duplicateOptional(allocator, try row.get(?[]const u8, 23)),
            },
        },
        .media = .{ .artifacts = artifacts, .origins = origins },
        .access = .{
            .visibility = try parseEnum(track.Visibility, try row.get([]const u8, 27)),
            .in_discovery = try row.get(bool, 28),
            .gate = if (try row.get(?[]const u8, 16)) |gate_type| .{
                .type = try duplicate(allocator, gate_type),
            } else null,
            .space_uri = try duplicateOptional(allocator, try row.get(?[]const u8, 29)),
        },
        .moderation = .{
            .self_labels = try parseLabels(allocator, try row.get([]const u8, 17)),
            .operator_labels = try parseLabels(allocator, try row.get([]const u8, 30)),
            .override = if (try row.get(?[]const u8, 31)) |value|
                try parseEnum(track.ModerationOverride, value)
            else
                null,
        },
        .metrics = .{
            .play_count = try row.get(i64, 32),
            .like_count = try row.get(i64, 44),
        },
        .sources = .{
            .record = .verified_repo,
            .metadata = .verified_repo,
            .artist_identity = .verified_repo,
            .artist_handle = .legacy_projection,
            .artist_display_name = .legacy_projection,
            .artist_avatar = if (authored_avatar) .authored_profile else .legacy_projection,
            .artist_bio = if (authored_bio) .authored_profile else .legacy_projection,
            .media_artifacts = if (delivery_artifact_cid != null) .mixed else .verified_repo,
            .media_origins = if (delivery_url != null and authored_url == null and legacy_url == null)
                .verified_delivery
            else if (authored_url != null and delivery_url == null and legacy_url == null)
                .verified_repo
            else if (legacy_url != null and authored_url == null and delivery_url == null)
                .legacy_projection
            else if (authored_url != null or delivery_url != null or legacy_url != null)
                .mixed
            else if (!has_legacy_track)
                .verified_repo
            else
                .legacy_projection,
            .access = if (has_access_policy) .application_policy else .derived,
            .self_labels = .verified_repo,
            .operator_labels = if (has_moderation_policy) .moderation_service else .derived,
            .metrics = if (has_metrics) .application_metrics else .derived,
            .like_count = .derived,
            .account_availability = availability_source,
        },
        .projection = .{
            .indexed_at = try duplicate(allocator, try row.get([]const u8, 33)),
            .verification = .verified_repo,
        },
    };
}

pub const projected_columns =
    \\  v.record_uri,
    \\  v.record_cid,
    \\  v.commit_rev,
    \\  v.collection,
    \\  v.rkey,
    \\  v.title,
    \\  v.artist_name,
    \\  v.description,
    \\  v.album,
    \\  v.duration_seconds,
    \\  v.record_created_at,
    \\  v.audio_blob_cid,
    \\  v.audio_blob_media_type,
    \\  v.audio_blob_size,
    \\  v.audio_url,
    \\  v.file_type,
    \\  v.support_gate_type,
    \\  array_to_json(v.self_labels)::text,
    \\  v.owner_did,
    \\  a.handle,
    \\  a.display_name,
    \\  COALESCE(p.avatar, a.avatar_url),
    \\  p.avatar IS NOT NULL,
    \\  COALESCE(p.bio, a.bio),
    \\  p.bio IS NOT NULL,
    \\  t.r2_url,
    \\  t.file_type,
    \\  COALESCE(pol.visibility, 'public'),
    \\  COALESCE(pol.visibility, 'public') IN ('public', 'supporters'),
    \\  pol.space_uri,
    \\  COALESCE(pol.operator_labels, '[]'::jsonb)::text,
    \\  pol.moderation_decision,
    \\  COALESCE(metrics.play_count, 0)::bigint,
    \\  to_char(
    \\    TIMESTAMPTZ 'epoch' + (v.indexed_at_us * INTERVAL '1 microsecond'),
    \\    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    \\  ),
    \\  aa.evidence_source,
    \\  t.atproto_record_uri IS NOT NULL,
    \\  (extract(epoch FROM v.record_created_at::timestamptz) * 1000000)::bigint,
    \\  d.origin_url,
    \\  d.media_type,
    \\  d.artifact_cid,
    \\  d.verification,
    \\  pol.visibility IS NOT NULL,
    \\  pol.moderation_write_source IS NOT NULL,
    \\  metrics.record_uri IS NOT NULL,
    \\  COALESCE(like_metrics.like_count, 0)::bigint
;

pub const projected_from =
    \\FROM plyr_index.track_records AS v
    \\JOIN plyr_index.account_availability AS aa
    \\  ON aa.repo_did = v.owner_did AND aa.available
    \\LEFT JOIN tracks AS t ON t.atproto_record_uri = v.record_uri
    \\LEFT JOIN plyr_index.track_delivery_origins AS d
    \\  ON d.record_uri = v.record_uri AND d.record_cid = v.record_cid
    \\  AND d.service = 'r2' AND d.verification = 'verified_blob_cid'
    \\LEFT JOIN plyr_index.track_policies AS pol
    \\  ON pol.record_uri = v.record_uri
    \\LEFT JOIN plyr_index.track_metrics AS metrics
    \\  ON metrics.record_uri = v.record_uri
    \\LEFT JOIN LATERAL (
    \\  SELECT count(DISTINCT likes.owner_did)::bigint AS like_count
    \\  FROM plyr_index.like_records AS likes
    \\  JOIN plyr_index.account_availability AS liker_account
    \\    ON liker_account.repo_did = likes.owner_did AND liker_account.available
    \\  WHERE likes.subject_uri = v.record_uri AND likes.subject_cid = v.record_cid
    \\    AND likes.collection = $3 AND NOT likes.deleted
    \\) AS like_metrics ON true
    \\JOIN artists AS a ON a.did = v.owner_did
    \\LEFT JOIN plyr_index.profile_records AS p
    \\  ON p.owner_did = v.owner_did AND p.collection = $2
    \\  AND p.rkey = 'self' AND NOT p.deleted
;

const joined_projection = "SELECT\n" ++ projected_columns ++ "\n" ++ projected_from;

const common_policy =
    \\  AND NOT v.deleted
    \\  AND pol.moderation_decision IS DISTINCT FROM 'exclude'
    \\  AND (
    \\    pol.moderation_decision IS NOT DISTINCT FROM 'allow'
    \\    OR NOT (
    \\      v.self_labels && ARRAY['copyright-violation']::text[]
    \\      OR COALESCE(pol.operator_labels, '[]'::jsonb) ?| ARRAY['copyright-violation']
    \\    )
    \\  )
;

const detail_query = joined_projection ++ "\n" ++
    \\WHERE v.record_uri = $1
    \\  AND COALESCE(pol.visibility, 'public') <> 'private'
++ common_policy ++ "\n" ++
    \\LIMIT 1
;

pub const discovery_policy = common_policy ++
    \\  AND v.collection = $1
    \\  AND COALESCE(pol.visibility, 'public') IN ('public', 'supporters')
    \\  AND NOT (
    \\    v.self_labels && ARRAY['sexual', 'porn']::text[]
    \\    OR COALESCE(pol.operator_labels, '[]'::jsonb) ?| ARRAY['sexual', 'porn']
    \\  )
;

const artist_policy = common_policy ++
    \\  AND v.collection = $1
    \\  AND v.owner_did = $4
    \\  AND COALESCE(pol.visibility, 'public') <> 'private'
;

const discovery_query = joined_projection ++ "\nWHERE true\n" ++ discovery_policy ++ "\n" ++
    \\ORDER BY v.record_created_at::timestamptz DESC, v.record_uri DESC
    \\LIMIT $4::bigint
;

const discovery_after_query = joined_projection ++ "\nWHERE true\n" ++ discovery_policy ++ "\n" ++
    \\  AND (
    \\    v.record_created_at::timestamptz < TIMESTAMPTZ 'epoch' + ($4::bigint * INTERVAL '1 microsecond')
    \\    OR (v.record_created_at::timestamptz = TIMESTAMPTZ 'epoch' + ($4::bigint * INTERVAL '1 microsecond')
    \\      AND v.record_uri < $5)
    \\  )
    \\ORDER BY v.record_created_at::timestamptz DESC, v.record_uri DESC
    \\LIMIT $6::bigint
;

const artist_query = joined_projection ++ "\nWHERE true\n" ++ artist_policy ++ "\n" ++
    \\ORDER BY v.record_created_at::timestamptz DESC, v.record_uri DESC
    \\LIMIT $5::bigint
;

const artist_after_query = joined_projection ++ "\nWHERE true\n" ++ artist_policy ++ "\n" ++
    \\  AND (
    \\    v.record_created_at::timestamptz < TIMESTAMPTZ 'epoch' + ($5::bigint * INTERVAL '1 microsecond')
    \\    OR (v.record_created_at::timestamptz = TIMESTAMPTZ 'epoch' + ($5::bigint * INTERVAL '1 microsecond')
    \\      AND v.record_uri < $6)
    \\  )
    \\ORDER BY v.record_created_at::timestamptz DESC, v.record_uri DESC
    \\LIMIT $7::bigint
;

const readiness_sql =
    \\SELECT 1
    \\WHERE to_regclass('plyr_index.track_records') IS NOT NULL
    \\  AND to_regclass('plyr_index.account_availability') IS NOT NULL
    \\  AND to_regclass('plyr_index.profile_records') IS NOT NULL
    \\  AND to_regclass('plyr_index.track_delivery_origins') IS NOT NULL
    \\  AND to_regclass('plyr_index.track_policies') IS NOT NULL
    \\  AND to_regclass('plyr_index.track_metrics') IS NOT NULL
    \\  AND to_regclass('plyr_index.like_records') IS NOT NULL
    \\  AND to_regclass('tracks') IS NOT NULL
    \\  AND to_regclass('artists') IS NOT NULL
;

fn finishQueryRow(query_row: *pg.QueryRow) !void {
    query_row.deinit() catch |err| {
        query_row.result.deinit();
        return err;
    };
}

fn forceReleaseQueryRow(query_row: *pg.QueryRow) void {
    finishQueryRow(query_row) catch |err|
        std.log.err("forced composed track result cleanup: {}", .{err});
}

fn duplicate(allocator: std.mem.Allocator, value: []const u8) ![]const u8 {
    return allocator.dupe(u8, value);
}

fn duplicateOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |present| try duplicate(allocator, present) else null;
}

fn parseLabels(allocator: std.mem.Allocator, raw: []const u8) ![]const []const u8 {
    const parsed = try std.json.parseFromSlice([]const []const u8, allocator, raw, .{});
    return parsed.value;
}

fn parseEnum(comptime T: type, value: []const u8) !T {
    return std.meta.stringToEnum(T, value) orelse error.CorruptProjectionEnum;
}

fn parseSource(value: []const u8) !track.Source {
    if (std.mem.eql(u8, value, "verified_repository")) return .verified_repo;
    if (std.mem.eql(u8, value, "current_pds")) return .current_pds;
    return error.CorruptAvailabilitySource;
}

test "composed PostgreSQL reads use verified records and authoritative account state" {
    const postgres_test_lock = @import("../testing/postgres_lock.zig");
    const projected_tracks = @import("../projection/postgres_track_store.zig");
    const projected_profiles = @import("../projection/postgres_profile_store.zig");
    const projected_availability = @import("../account/postgres_availability_store.zig");
    const projected_lists = @import("../projection/postgres_list_store.zig");
    const projected_likes = @import("../projection/postgres_like_store.zig");
    const track_change = @import("../projection/track_change.zig");
    const postgres_playback = @import("postgres_playback_store.zig");
    const postgres_search = @import("postgres_search_store.zig");
    const postgres_verified_lists = @import("postgres_verified_list_store.zig");
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const database_uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, database_uri, .{ .size = 1 });
    defer pool.deinit();
    try requireDisposableDatabase(pool, allocator);
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("DROP TABLE IF EXISTS tracks CASCADE", .{});
    _ = try pool.exec("DROP TABLE IF EXISTS artists CASCADE", .{});
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm", .{});
    try projected_tracks.createTestTable(pool);
    try projected_profiles.createTestTable(pool);
    try projected_availability.createTestTable(pool);
    try projected_lists.createTestTables(pool);
    try projected_likes.createTestTable(pool);
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.track_delivery_origins (
        \\  record_uri text NOT NULL, service text NOT NULL, record_cid text NOT NULL,
        \\  origin_url text NOT NULL, media_type text NOT NULL, artifact_cid text NOT NULL,
        \\  verification text NOT NULL, observed_at_us bigint NOT NULL,
        \\  PRIMARY KEY (record_uri, service)
        \\)
    , .{});
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.track_policies (
        \\  record_uri text PRIMARY KEY, visibility text, space_uri text,
        \\  access_write_source text, access_observed_at_us bigint,
        \\  operator_labels jsonb NOT NULL DEFAULT '[]', moderation_decision text,
        \\  moderation_write_source text, moderation_observed_at_us bigint
        \\)
    , .{});
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.track_metrics (
        \\  record_uri text PRIMARY KEY, play_count bigint NOT NULL,
        \\  write_source text NOT NULL, observed_at_us bigint NOT NULL
        \\)
    , .{});
    _ = try pool.exec(
        \\CREATE TABLE artists (
        \\  did text PRIMARY KEY, handle text NOT NULL, display_name text NOT NULL,
        \\  bio text, avatar_url text, deactivated boolean NOT NULL DEFAULT false
        \\)
    , .{});
    _ = try pool.exec(
        \\CREATE TABLE tracks (
        \\  atproto_record_uri text PRIMARY KEY,
        \\  created_at timestamptz NOT NULL,
        \\  r2_url text,
        \\  file_type text NOT NULL,
        \\  visibility text NOT NULL,
        \\  space_uri text,
        \\  operator_labels jsonb NOT NULL DEFAULT '[]',
        \\  moderation_override text,
        \\  play_count integer NOT NULL DEFAULT 0,
        \\  publish_state text
        \\)
    , .{});
    const did = "did:plc:artist";
    const record_uri = "at://did:plc:artist/fm.plyr.dev.track/track";
    _ = try pool.exec(
        "INSERT INTO artists VALUES ($1, 'artist.example', 'Legacy Name', 'legacy bio', 'https://legacy.example/avatar.jpg')",
        .{did},
    );
    _ = try pool.exec(
        \\INSERT INTO tracks VALUES (
        \\  $1, '2026-08-08T12:00:00Z', 'https://r2.example/audio.flac',
        \\  'audio/flac', 'public', NULL, '["legacy-note"]', NULL, 700, 'published'
        \\)
    , .{record_uri});
    _ = try pool.exec(
        "INSERT INTO plyr_index.track_policies VALUES ($1, 'public', NULL, 'legacy_import', 1000, '[\"copyright-violation\"]', 'allow', 'legacy_import', 1000)",
        .{record_uri},
    );
    _ = try pool.exec(
        "INSERT INTO plyr_index.track_metrics VALUES ($1, 7, 'legacy_import', 1000)",
        .{record_uri},
    );

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const commit = try zat.Cid.forDagCbor(a, "commit");
    const record = try zat.Cid.forDagCbor(a, "record");
    const blob = try zat.Cid.create(a, 1, zat.cbor.Codec.raw, zat.cbor.HashFn.sha2_256, "audio");
    const rev = zat.Tid.fromTimestamp(1_000, 1);
    var track_writer: projected_tracks.PostgresTrackStore = .{ .pool = pool };
    const change: track_change.Change = .{ .upsert = .{
        .record_uri = record_uri,
        .record_cid = try record.toString(a),
        .owner_did = did,
        .collection = "fm.plyr.dev.track",
        .rkey = "track",
        .title = "Verified Title",
        .artist_name = "Authored Credit",
        .file_type = "flac",
        .created_at = "2026-08-08T11:00:00Z",
        .audio_url = "https://pds.example/audio.flac",
        .audio_blob = .{
            .cid = try blob.toString(a),
            .media_type = "audio/flac",
            .size = 42,
        },
        .album = "Verified Album",
        .duration_seconds = 180,
        .featured_dids = &.{},
        .image_url = null,
        .support_gate_type = "future-gate",
        .description = "verified description",
        .self_labels = &.{"self-note"},
        .proof = .{ .commit_cid = commit, .commit_rev = rev.str(), .indexed_at_us = 1_000 },
    } };
    try std.testing.expectEqual(
        @import("../projection/track_store.zig").ApplyResult.applied,
        try track_writer.store().apply(a, change),
    );
    var profile_writer: projected_profiles.PostgresProfileStore = .{ .pool = pool };
    try std.testing.expectEqual(
        @import("../projection/profile_store.zig").ApplyResult.applied,
        try profile_writer.store().apply(a, projected_profiles.profileUpsert(
            "authored bio",
            rev.str(),
            commit,
            1_000,
        )),
    );
    _ = try pool.exec(
        "UPDATE plyr_index.profile_records SET avatar = 'https://pds.example/avatar.jpg'",
        .{},
    );
    var availability_writer: projected_availability.PostgresAvailabilityStore = .{ .pool = pool };
    try std.testing.expectEqual(
        @import("../account/availability.zig").ApplyResult.applied,
        try availability_writer.store().apply(a, .{
            .repo_did = did,
            .available = true,
            .source = .verified_repository,
            .repository_rev = rev.str(),
            .commit_cid = commit,
            .observed_at_us = 1_000,
        }),
    );

    var implementation: PostgresComposedTrackStore = .{
        .pool = pool,
        .profile_collection = "fm.plyr.dev.actor.profile",
        .like_collection = "fm.plyr.dev.like",
    };
    try std.testing.expect(implementation.store().ready());
    const value = (try implementation.store().getByUri(a, record_uri)).?;
    try std.testing.expectEqualStrings("Verified Title", value.metadata.title);
    try std.testing.expectEqualStrings("Authored Credit", value.metadata.artist_name.?);
    try std.testing.expectEqualStrings("authored bio", value.artist.profile.bio.?);
    try std.testing.expectEqualStrings("https://pds.example/avatar.jpg", value.artist.profile.avatar_url.?);
    try std.testing.expectEqualStrings("future-gate", value.access.gate.?.type);
    try std.testing.expectEqual(@as(usize, 1), value.media.artifacts.len);
    try std.testing.expectEqual(@as(usize, 2), value.media.origins.len);
    try std.testing.expectEqual(track.Source.verified_repo, value.sources.record);
    try std.testing.expectEqual(track.Source.authored_profile, value.sources.artist_bio);
    try std.testing.expectEqual(track.Source.verified_repo, value.sources.account_availability);
    try std.testing.expectEqual(track.Source.application_policy, value.sources.access);
    try std.testing.expectEqual(track.Source.application_metrics, value.sources.metrics);
    try std.testing.expectEqual(track.Source.moderation_service, value.sources.operator_labels);
    try std.testing.expectEqual(track.ProjectionVerification.verified_repo, value.projection.verification);
    try std.testing.expectEqualStrings("self-note", value.moderation.self_labels[0]);
    try std.testing.expectEqualStrings("copyright-violation", value.moderation.operator_labels[0]);
    try std.testing.expectEqual(@as(i64, 7), value.metrics.play_count);
    try std.testing.expectEqual(@as(i64, 0), value.metrics.like_count);

    for ([_][]const u8{ "did:plc:listenerone", "did:plc:listenertwo" }) |listener| {
        try std.testing.expectEqual(
            @import("../account/availability.zig").ApplyResult.applied,
            try availability_writer.store().apply(a, .{
                .repo_did = listener,
                .available = true,
                .source = .verified_repository,
                .repository_rev = rev.str(),
                .commit_cid = commit,
                .observed_at_us = 1_000,
            }),
        );
    }
    const record_cid = try record.toString(a);
    const stale_subject_cid = try (try zat.Cid.forDagCbor(a, "stale subject")).toString(a);
    var like_writer: projected_likes.PostgresLikeStore = .{ .pool = pool };
    for ([_]@import("../projection/like_change.zig").Change{
        .{ .upsert = .{
            .record_uri = "at://did:plc:listenerone/fm.plyr.dev.like/one",
            .record_cid = record_cid,
            .owner_did = "did:plc:listenerone",
            .collection = "fm.plyr.dev.like",
            .rkey = "one",
            .subject_uri = record_uri,
            .subject_cid = record_cid,
            .created_at = "2026-08-09T01:00:00Z",
            .proof = .{ .commit_cid = commit, .commit_rev = rev.str(), .indexed_at_us = 1_000 },
        } },
        .{ .upsert = .{
            .record_uri = "at://did:plc:listenerone/fm.plyr.dev.like/duplicate",
            .record_cid = record_cid,
            .owner_did = "did:plc:listenerone",
            .collection = "fm.plyr.dev.like",
            .rkey = "duplicate",
            .subject_uri = record_uri,
            .subject_cid = record_cid,
            .created_at = "2026-08-09T02:00:00Z",
            .proof = .{ .commit_cid = commit, .commit_rev = rev.str(), .indexed_at_us = 1_000 },
        } },
        .{ .upsert = .{
            .record_uri = "at://did:plc:listenertwo/fm.plyr.dev.like/stale",
            .record_cid = record_cid,
            .owner_did = "did:plc:listenertwo",
            .collection = "fm.plyr.dev.like",
            .rkey = "stale",
            .subject_uri = record_uri,
            .subject_cid = stale_subject_cid,
            .created_at = "2026-08-09T03:00:00Z",
            .proof = .{ .commit_cid = commit, .commit_rev = rev.str(), .indexed_at_us = 1_000 },
        } },
        .{ .upsert = .{
            .record_uri = "at://did:plc:listenertwo/com.example.like/wrong-namespace",
            .record_cid = record_cid,
            .owner_did = "did:plc:listenertwo",
            .collection = "com.example.like",
            .rkey = "wrong-namespace",
            .subject_uri = record_uri,
            .subject_cid = record_cid,
            .created_at = "2026-08-09T04:00:00Z",
            .proof = .{ .commit_cid = commit, .commit_rev = rev.str(), .indexed_at_us = 1_000 },
        } },
    }) |like_change| {
        try std.testing.expectEqual(
            @import("../projection/like_store.zig").ApplyResult.applied,
            try like_writer.store().apply(a, like_change),
        );
    }
    const counted = (try implementation.store().getByUri(a, record_uri)).?;
    try std.testing.expectEqual(@as(i64, 1), counted.metrics.like_count);

    const list_uri = "at://did:plc:artist/fm.plyr.dev.list/road-mix";
    const album_list_uri = "at://did:plc:artist/fm.plyr.dev.list/album";
    const list_cid = try (try zat.Cid.forDagCbor(a, "playlist")).toString(a);
    const stale_member_cid = try (try zat.Cid.forDagCbor(a, "stale-track")).toString(a);
    _ = try pool.exec(
        \\INSERT INTO plyr_index.list_records VALUES
        \\  ($1, $2, $3, 'fm.plyr.dev.list', 'road-mix', 'playlist', 'Road Mix',
        \\   '2026-08-09T12:00:00Z', NULL, false, $4, $5, 1000),
        \\  ($6, $2, $3, 'fm.plyr.dev.list', 'album', 'album', 'Verified Album',
        \\   '2026-08-08T12:00:00Z', NULL, false, $4, $5, 1000)
    , .{ list_uri, list_cid, did, try commit.toString(a), rev.str(), album_list_uri });
    _ = try pool.exec(
        \\INSERT INTO plyr_index.list_members VALUES
        \\  ($1, 0, $2, $3), ($1, 1, $2, $4)
    , .{ list_uri, record_uri, try record.toString(a), stale_member_cid });
    _ = try pool.exec(
        "INSERT INTO plyr_index.list_members VALUES ($1, 0, $2, $3)",
        .{ album_list_uri, record_uri, try record.toString(a) },
    );
    var search_implementation: postgres_search.PostgresSearchStore = .{ .pool = pool };
    const search_store = search_implementation.store();
    const search_request = @import("search_store.zig").Request{
        .query = "artist.example",
        .types = .{},
        .limit = 20,
        .track_collection = "fm.plyr.dev.track",
        .list_collection = "fm.plyr.dev.list",
        .profile_collection = "fm.plyr.dev.actor.profile",
    };
    const exact_handle_hits = try search_store.search(a, search_request);
    try std.testing.expectEqual(@as(usize, 1), exact_handle_hits.len);
    try std.testing.expectEqual(@import("../domain/search.zig").Kind.artist, exact_handle_hits[0].type);
    try std.testing.expectEqual(@import("../domain/search.zig").MatchKind.exact, exact_handle_hits[0].match.kind);
    try std.testing.expectEqual(@import("../domain/search.zig").MatchField.handle, exact_handle_hits[0].match.field);
    try std.testing.expectEqualStrings(did, exact_handle_hits[0].id);
    try std.testing.expectEqualStrings("verified_repo", exact_handle_hits[0].projection.verification);

    var verified_query = search_request;
    verified_query.query = "Verified";
    verified_query.types = .{ .artist = false, .playlist = false };
    const verified_hits = try search_store.search(a, verified_query);
    try std.testing.expectEqual(@as(usize, 2), verified_hits.len);
    try std.testing.expectEqual(@import("../domain/search.zig").Kind.album, verified_hits[0].type);
    try std.testing.expectEqual(@import("../domain/search.zig").Kind.track, verified_hits[1].type);
    try std.testing.expect(std.mem.startsWith(u8, verified_hits[0].id, "alb_"));
    try std.testing.expect(std.mem.startsWith(u8, verified_hits[1].id, "trk_"));
    try std.testing.expectEqual(@as(?usize, 1), verified_hits[0].metrics.member_count);
    try std.testing.expectEqual(@as(?i64, 7), verified_hits[1].metrics.play_count);
    var wildcard_query = search_request;
    wildcard_query.query = "%%";
    try std.testing.expectEqual(@as(usize, 0), (try search_store.search(a, wildcard_query)).len);
    var verified_list_implementation: postgres_verified_lists.PostgresVerifiedListStore = .{
        .pool = pool,
        .like_collection = "fm.plyr.dev.like",
    };
    const list_store = verified_list_implementation.store();
    const playlist_page = try list_store.listByOwner(a, .{
        .collection = "fm.plyr.dev.list",
        .profile_collection = "fm.plyr.dev.actor.profile",
        .kind = .playlist,
        .owner_did = did,
        .limit = 2,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 1), playlist_page.len);
    try std.testing.expectEqual(@as(usize, 2), playlist_page[0].value.metrics.member_count);
    try std.testing.expectEqual(@as(usize, 1), playlist_page[0].value.metrics.available_count);
    try std.testing.expectEqual(@as(i64, 7), playlist_page[0].value.metrics.total_plays);
    try std.testing.expectEqualStrings("artist.example", playlist_page[0].value.owner.profile.?.handle);
    const album_page = try list_store.listByOwner(a, .{
        .collection = "fm.plyr.dev.list",
        .profile_collection = "fm.plyr.dev.actor.profile",
        .kind = .album,
        .owner_did = did,
        .limit = 2,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 1), album_page.len);
    try std.testing.expectEqual(verified_list.Kind.album, album_page[0].value.object);
    try std.testing.expectEqualStrings(album_list_uri, album_page[0].value.record.uri);
    try std.testing.expectEqualStrings("Verified Album", album_page[0].value.metadata.name.?);
    try std.testing.expectEqual(@as(usize, 1), album_page[0].value.metrics.member_count);
    try std.testing.expectEqual(@as(usize, 1), album_page[0].value.metrics.available_count);
    try std.testing.expectEqual(track.Source.verified_repo, album_page[0].value.sources.record);
    try std.testing.expectEqualStrings("verified_repo", album_page[0].value.projection.verification);
    const playlist_detail = (try list_store.getByUri(a, .{
        .uri = list_uri,
        .list_collection = "fm.plyr.dev.list",
        .track_collection = "fm.plyr.dev.track",
        .profile_collection = "fm.plyr.dev.actor.profile",
        .kind = .playlist,
    })).?;
    try std.testing.expectEqual(@as(usize, 2), playlist_detail.members.len);
    try std.testing.expectEqual(@import("../domain/verified_list.zig").Availability.available, playlist_detail.members[0].availability);
    try std.testing.expectEqual(@import("../domain/verified_list.zig").Availability.unavailable, playlist_detail.members[1].availability);
    try std.testing.expectEqualStrings("Verified Title", playlist_detail.members[0].track.?.metadata.title);
    try std.testing.expectEqual(@as(i64, 7), playlist_detail.metrics.total_plays);
    const album_detail = (try list_store.getByUri(a, .{
        .uri = album_list_uri,
        .list_collection = "fm.plyr.dev.list",
        .track_collection = "fm.plyr.dev.track",
        .profile_collection = "fm.plyr.dev.actor.profile",
        .kind = .album,
    })).?;
    try std.testing.expectEqual(@import("../domain/verified_list.zig").Kind.album, album_detail.object);
    try std.testing.expect(std.mem.startsWith(u8, album_detail.id, "alb_"));
    try std.testing.expectEqualStrings("Verified Title", album_detail.members[0].track.?.metadata.title);

    _ = try pool.exec(
        \\INSERT INTO plyr_index.track_delivery_origins VALUES (
        \\  $1, 'r2', $2, 'https://r2.example/verified.flac', 'audio/flac',
        \\  $3, 'verified_blob_cid', 1100
        \\)
    , .{ record_uri, try record.toString(a), try blob.toString(a) });
    const delivered = (try implementation.store().getByUri(a, record_uri)).?;
    try std.testing.expectEqual(@as(usize, 3), delivered.media.origins.len);
    try std.testing.expectEqualStrings(
        "https://r2.example/verified.flac",
        delivered.media.origins[1].url,
    );
    try std.testing.expectEqualStrings(
        try blob.toString(a),
        delivered.media.origins[1].artifact_cid.?,
    );
    try std.testing.expectEqual(track.ArtifactVerification.verified, delivered.media.artifacts[0].verification);
    try std.testing.expectEqual(track.Source.mixed, delivered.sources.media_artifacts);
    try std.testing.expectEqual(track.Source.verified_delivery, delivered.media.origins[1].source);
    try std.testing.expectEqual(track.Source.mixed, delivered.sources.media_origins);
    var playback_implementation: postgres_playback.PostgresPlaybackStore = .{ .pool = pool };
    const playback_candidate = (try playback_implementation.store().getByUri(a, record_uri)).?;
    try std.testing.expectEqualStrings(record_uri, playback_candidate.record_uri);
    try std.testing.expectEqualStrings("future-gate", playback_candidate.gate_type.?);
    try std.testing.expectEqualStrings(
        "https://r2.example/verified.flac",
        playback_candidate.verified_delivery.?.url,
    );
    try std.testing.expectEqual(
        @import("../domain/playback.zig").Integrity.verified_blob_cid,
        playback_candidate.verified_delivery.?.integrity,
    );
    try std.testing.expectEqualStrings(
        "https://pds.example/audio.flac",
        playback_candidate.authored_delivery.?.url,
    );

    _ = try pool.exec(
        "UPDATE plyr_index.track_delivery_origins SET origin_url = 'https://pds.example/audio.flac'",
        .{},
    );
    const shared_origin = (try implementation.store().getByUri(a, record_uri)).?;
    try std.testing.expectEqual(@as(usize, 2), shared_origin.media.origins.len);
    try std.testing.expectEqual(track.Source.mixed, shared_origin.media.origins[0].source);
    try std.testing.expectEqualStrings(
        try blob.toString(a),
        shared_origin.media.origins[0].artifact_cid.?,
    );

    _ = try pool.exec(
        "UPDATE plyr_index.track_delivery_origins SET record_cid = $1",
        .{try commit.toString(a)},
    );
    const stale_delivery = (try implementation.store().getByUri(a, record_uri)).?;
    try std.testing.expectEqual(@as(usize, 2), stale_delivery.media.origins.len);
    try std.testing.expectEqual(track.ArtifactVerification.declared, stale_delivery.media.artifacts[0].verification);
    const stale_playback = (try playback_implementation.store().getByUri(a, record_uri)).?;
    try std.testing.expect(stale_playback.verified_delivery == null);
    try std.testing.expect(stale_playback.authored_delivery != null);

    const pds_only_uri = "at://did:plc:artist/fm.plyr.dev.track/pds-only";
    var pds_only = change;
    pds_only.upsert.record_uri = pds_only_uri;
    pds_only.upsert.rkey = "pds-only";
    pds_only.upsert.title = "PDS-only Track";
    pds_only.upsert.audio_url = "https://pds.example/pds-only.flac";
    try std.testing.expectEqual(
        @import("../projection/track_store.zig").ApplyResult.applied,
        try track_writer.store().apply(a, pds_only),
    );
    const pds_only_value = (try implementation.store().getByUri(a, pds_only_uri)).?;
    try std.testing.expectEqual(track.Visibility.public, pds_only_value.access.visibility);
    try std.testing.expect(pds_only_value.access.in_discovery);
    try std.testing.expectEqual(@as(usize, 1), pds_only_value.media.origins.len);
    try std.testing.expectEqual(track.Source.verified_repo, pds_only_value.sources.media_origins);
    try std.testing.expectEqual(track.Source.derived, pds_only_value.sources.access);
    try std.testing.expectEqual(track.Source.derived, pds_only_value.sources.operator_labels);
    try std.testing.expectEqual(@as(usize, 0), pds_only_value.moderation.operator_labels.len);
    try std.testing.expectEqual(@as(i64, 0), pds_only_value.metrics.play_count);

    _ = try pool.exec(
        "UPDATE plyr_index.track_policies SET visibility = 'unlisted' WHERE record_uri = $1",
        .{record_uri},
    );
    const unlisted = (try implementation.store().getByUri(a, record_uri)).?;
    try std.testing.expectEqual(track.Visibility.unlisted, unlisted.access.visibility);
    try std.testing.expect(!unlisted.access.in_discovery);
    try std.testing.expectEqual(@as(usize, 1), (try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 2,
        .after = null,
    })).len);
    try std.testing.expectEqual(@as(usize, 2), (try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .{ .artist = did },
        .limit = 2,
        .after = null,
    })).len);

    _ = try pool.exec(
        "UPDATE plyr_index.track_policies SET visibility = 'private' WHERE record_uri = $1",
        .{record_uri},
    );
    try std.testing.expect((try implementation.store().getByUri(a, record_uri)) == null);
    try std.testing.expect((try playback_implementation.store().getByUri(a, record_uri)) == null);
    var private_query = search_request;
    private_query.query = "Verified Title";
    private_query.types = .{ .artist = false, .album = false, .playlist = false };
    try std.testing.expectEqual(@as(usize, 0), (try search_store.search(a, private_query)).len);
    _ = try pool.exec(
        "UPDATE plyr_index.track_policies SET visibility = 'public' WHERE record_uri = $1",
        .{record_uri},
    );

    _ = try pool.exec(
        "UPDATE plyr_index.track_policies SET operator_labels = '[\"sexual\"]', moderation_decision = NULL WHERE record_uri = $1",
        .{record_uri},
    );
    try std.testing.expect((try implementation.store().getByUri(a, record_uri)) != null);
    try std.testing.expectEqual(@as(usize, 0), (try search_store.search(a, private_query)).len);
    try std.testing.expectEqual(@as(usize, 1), (try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 2,
        .after = null,
    })).len);
    try std.testing.expectEqual(@as(usize, 2), (try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .{ .artist = did },
        .limit = 2,
        .after = null,
    })).len);

    _ = try pool.exec(
        "UPDATE plyr_index.track_policies SET operator_labels = '[\"copyright-violation\"]' WHERE record_uri = $1",
        .{record_uri},
    );
    try std.testing.expect((try implementation.store().getByUri(a, record_uri)) == null);
    _ = try pool.exec(
        "UPDATE plyr_index.track_policies SET moderation_decision = 'allow' WHERE record_uri = $1",
        .{record_uri},
    );
    try std.testing.expect((try implementation.store().getByUri(a, record_uri)) != null);
    _ = try pool.exec(
        "UPDATE plyr_index.track_policies SET operator_labels = '[]', moderation_decision = 'exclude' WHERE record_uri = $1",
        .{record_uri},
    );
    try std.testing.expect((try implementation.store().getByUri(a, record_uri)) == null);
    _ = try pool.exec(
        "UPDATE plyr_index.track_policies SET operator_labels = '[\"copyright-violation\"]', moderation_decision = 'allow' WHERE record_uri = $1",
        .{record_uri},
    );

    const page = try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 2,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 2), page.len);
    _ = try pool.exec(
        "UPDATE plyr_index.track_records SET self_labels = ARRAY['sexual']::text[] WHERE record_uri = $1",
        .{record_uri},
    );
    try std.testing.expectEqual(@as(usize, 0), (try search_store.search(a, private_query)).len);
    try std.testing.expectEqual(@as(usize, 1), (try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 2,
        .after = null,
    })).len);
    try std.testing.expectEqual(@as(usize, 2), (try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .{ .artist = did },
        .limit = 2,
        .after = null,
    })).len);

    try std.testing.expectEqual(
        @import("../account/availability.zig").ApplyResult.applied,
        try availability_writer.store().apply(a, .{
            .repo_did = did,
            .available = false,
            .reason = .deactivated,
            .source = .current_pds,
            .pds_origin = "https://pds.example.com",
            .observed_at_us = 2_000,
        }),
    );
    try std.testing.expect((try implementation.store().getByUri(a, record_uri)) == null);
    try std.testing.expect((try playback_implementation.store().getByUri(a, record_uri)) == null);
    try std.testing.expectEqual(@as(usize, 0), (try search_store.search(a, search_request)).len);
    try std.testing.expect((try list_store.getByUri(a, .{
        .uri = list_uri,
        .list_collection = "fm.plyr.dev.list",
        .track_collection = "fm.plyr.dev.track",
        .profile_collection = "fm.plyr.dev.actor.profile",
        .kind = .playlist,
    })) == null);
}

fn requireDisposableDatabase(pool: *pg.Pool, allocator: std.mem.Allocator) !void {
    var row = (try pool.row("SELECT current_database()", .{})).?;
    defer row.deinit() catch {};
    const database = try allocator.dupe(u8, try row.get([]const u8, 0));
    defer allocator.free(database);
    if (!std.mem.eql(u8, database, "zig_test")) return error.UnsafeTestDatabase;
}
