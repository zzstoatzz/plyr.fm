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
const liked_track_store = @import("liked_track_store.zig");
const store_module = @import("track_store.zig");
const track_tag_sql = @import("track_tag_sql.zig");

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
            .tags_fn = tagsOpaque,
        };
    }

    pub fn likedStore(self: *PostgresComposedTrackStore) liked_track_store.Store {
        return .{ .context = self, .list_fn = listLikedOpaque };
    }

    fn tagsOpaque(context: *anyopaque, allocator: std.mem.Allocator, collection: []const u8, limit: usize) TrackStore.Error![]const store_module.Tag {
        const self: *PostgresComposedTrackStore = @ptrCast(@alignCast(context));
        var result = self.pool.query(tags_query, .{ collection, @as(i64, @intCast(limit)) }) catch return error.IndexUnavailable;
        defer result.deinit();
        var data: std.ArrayList(store_module.Tag) = .empty;
        while (result.next() catch return error.IndexUnavailable) |row| {
            const count = row.get(i64, 1) catch return error.CorruptProjection;
            const plays = row.get(i64, 2) catch return error.CorruptProjection;
            if (count <= 0 or plays < 0) return error.CorruptProjection;
            try data.append(allocator, .{
                .name = try allocator.dupe(u8, row.get([]const u8, 0) catch return error.CorruptProjection),
                .track_count = count,
                .total_plays = plays,
                .sources = .{
                    .verified_repo = row.get(i64, 3) catch return error.CorruptProjection,
                    .legacy_plyr = row.get(i64, 4) catch return error.CorruptProjection,
                },
            });
        }
        return data.toOwnedSlice(allocator);
    }

    fn listLikedOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: liked_track_store.Request,
    ) liked_track_store.Store.Error![]liked_track_store.Item {
        const self: *PostgresComposedTrackStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        const limit: i64 = @intCast(request.limit);
        var result = if (request.after) |after|
            conn.query(liked_after_query, .{
                request.track_collection,
                self.profile_collection,
                self.like_collection,
                request.actor_did,
                after.created_at_us,
                after.at_uri,
                limit,
            }) catch |err| {
                logQueryError(conn, "composed liked-track query failed", err);
                return error.IndexUnavailable;
            }
        else
            conn.query(liked_query, .{
                request.track_collection,
                self.profile_collection,
                self.like_collection,
                request.actor_did,
                limit,
            }) catch |err| {
                logQueryError(conn, "composed liked-track query failed", err);
                return error.IndexUnavailable;
            };
        defer result.deinit();
        var items: std.ArrayList(liked_track_store.Item) = .empty;
        errdefer items.deinit(allocator);
        while (result.next() catch return error.IndexUnavailable) |row| {
            const value = decodeRow(allocator, row) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            };
            const like_uri = row.get([]const u8, 47) catch return error.CorruptProjection;
            const parsed_like = zat.AtUri.parse(like_uri) orelse return error.CorruptProjection;
            if (!std.mem.eql(u8, parsed_like.authority(), request.actor_did) or
                !std.mem.eql(u8, parsed_like.collection() orelse return error.CorruptProjection, self.like_collection))
                return error.CorruptProjection;
            items.append(allocator, .{
                .value = value,
                .liked_at_us = row.get(i64, 46) catch return error.CorruptProjection,
                .like_uri = allocator.dupe(u8, like_uri) catch return error.OutOfMemory,
            }) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch return error.OutOfMemory;
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
                    request.tags,
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
                    request.tags,
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
                    request.tags,
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
                    request.tags,
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
    const artwork_url = try duplicateOptional(allocator, try row.get(?[]const u8, 45));
    if (artwork_url) |url| if (!lexicon_value.validUri(url)) return error.CorruptArtwork;
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
        .media = .{
            .artifacts = artifacts,
            .origins = origins,
            .artwork = if (artwork_url) |url| .{ .url = url, .source = .verified_repo } else null,
        },
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
    \\  p.bio,
    \\  p.bio IS NOT NULL,
    \\  NULL::text,
    \\  NULL::text,
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
    \\  false,
    \\  COALESCE(v.record_created_at_us, 0),
    \\  d.origin_url,
    \\  d.media_type,
    \\  d.artifact_cid,
    \\  d.verification,
    \\  pol.visibility IS NOT NULL,
    \\  pol.moderation_write_source IS NOT NULL,
    \\  metrics.record_uri IS NOT NULL,
    \\  COALESCE(like_metrics.like_count, 0)::bigint,
    \\  v.image_url
;

pub const projected_from = "FROM plyr_index.track_records AS v\n" ++ projected_joins;

pub const projected_joins =
    \\JOIN plyr_index.account_availability AS aa
    \\  ON aa.repo_did = v.owner_did AND aa.available
    \\LEFT JOIN plyr_index.track_delivery_origins AS d
    \\  ON d.record_uri = v.record_uri AND d.record_cid = v.record_cid
    \\  AND d.service = 'r2' AND d.verification = 'verified_blob_cid'
    \\LEFT JOIN plyr_index.track_policies AS pol
    \\  ON pol.record_uri = v.record_uri
    \\LEFT JOIN plyr_index.track_metrics AS metrics
    \\  ON metrics.record_uri = v.record_uri
    \\LEFT JOIN plyr_index.track_like_counts AS like_metrics
    \\  ON like_metrics.collection = $3 AND like_metrics.subject_uri = v.record_uri
    \\  AND like_metrics.subject_cid = v.record_cid
    \\JOIN plyr_index.actor_identities AS a ON a.did = v.owner_did
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
    \\  AND v.owner_did = $5
    \\  AND COALESCE(pol.visibility, 'public') <> 'private'
;

/// the joins a page's filters read, without the per-track data
pub const page_from =
    \\FROM plyr_index.track_records AS v
    \\JOIN plyr_index.account_availability AS aa ON aa.repo_did = v.owner_did AND aa.available
    \\JOIN plyr_index.actor_identities AS a ON a.did = v.owner_did
    \\LEFT JOIN plyr_index.track_policies AS pol ON pol.record_uri = v.record_uri
;

const page_order = "ORDER BY v.record_created_at_us DESC, v.record_uri DESC";

/// Filters, sorts, and limits on the cheap columns first, so the like-count
/// subquery and the other per-track joins run for one page, not the catalog.
fn pagedQuery(comptime filter: []const u8, comptime limit: []const u8) []const u8 {
    return "WITH page AS MATERIALIZED (\nSELECT v.record_uri\n" ++ page_from ++ "\nWHERE v.record_created_at_us IS NOT NULL\n" ++ filter ++ "\n" ++ page_order ++ "\nLIMIT " ++ limit ++ "\n)\nSELECT\n" ++ projected_columns ++
        "\nFROM page\nJOIN plyr_index.track_records AS v ON v.record_uri = page.record_uri\n" ++
        projected_joins ++ "\n" ++ page_order;
}

fn afterCursor(comptime at: []const u8, comptime uri: []const u8) []const u8 {
    return "\n  AND (v.record_created_at_us, v.record_uri) < (" ++ at ++ "::bigint, " ++ uri ++ ")";
}

const discovery_query = pagedQuery(discovery_policy ++ track_tag_sql.filter, "$5::bigint");
const discovery_after_query = pagedQuery(discovery_policy ++ track_tag_sql.filter ++ afterCursor("$5", "$6"), "$7::bigint");
const artist_query = pagedQuery(artist_policy ++ track_tag_sql.filter, "$6::bigint");
const artist_after_query = pagedQuery(artist_policy ++ track_tag_sql.filter ++ afterCursor("$6", "$7"), "$8::bigint");

const liked_joined_projection = "SELECT\n" ++ projected_columns ++
    \\, viewer_like.liked_at_us, viewer_like.like_uri
++ "\n" ++ projected_from ++ "\n" ++
    \\JOIN (
    \\  SELECT DISTINCT ON (likes.subject_uri, likes.subject_cid)
    \\    likes.subject_uri, likes.subject_cid, likes.record_uri AS like_uri,
    \\    likes.record_created_at_us AS liked_at_us
    \\  FROM plyr_index.like_records AS likes
    \\  WHERE likes.owner_did = $4 AND likes.collection = $3 AND NOT likes.deleted
    \\    AND likes.record_created_at_us IS NOT NULL
    \\  ORDER BY likes.subject_uri, likes.subject_cid,
    \\    likes.record_created_at_us DESC, likes.record_uri DESC
    \\) AS viewer_like
    \\  ON viewer_like.subject_uri = v.record_uri AND viewer_like.subject_cid = v.record_cid
;

const liked_policy = common_policy ++
    \\  AND v.collection = $1
    \\  AND (COALESCE(pol.visibility, 'public') <> 'private' OR v.owner_did = $4)
    \\  AND (
    \\    v.owner_did = $4
    \\    OR NOT (
    \\      v.self_labels && ARRAY['sexual', 'porn']::text[]
    \\      OR COALESCE(pol.operator_labels, '[]'::jsonb) ?| ARRAY['sexual', 'porn']
    \\    )
    \\  )
;

const liked_query = liked_joined_projection ++ "\nWHERE true\n" ++ liked_policy ++ "\n" ++
    \\ORDER BY viewer_like.liked_at_us DESC, viewer_like.like_uri DESC
    \\LIMIT $5::bigint
;

const liked_after_query = liked_joined_projection ++ "\nWHERE true\n" ++ liked_policy ++ "\n" ++
    \\  AND (
    \\    viewer_like.liked_at_us < $5
    \\    OR (viewer_like.liked_at_us = $5 AND viewer_like.like_uri < $6)
    \\  )
    \\ORDER BY viewer_like.liked_at_us DESC, viewer_like.like_uri DESC
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
    \\  AND to_regclass('plyr_index.actor_identities') IS NOT NULL
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
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm", .{});
    try projected_tracks.createTestTable(pool);
    try projected_profiles.createTestTable(pool);
    try projected_availability.createTestTable(pool);
    try projected_lists.createTestTables(pool);
    try projected_likes.createTestTable(pool);
    try @import("../projection/like_counts.zig").applyTestMigration(pool);
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
    try @import("../identity/postgres_actor_identity_store.zig").createTestTable(pool);
    const did = "did:plc:artist";
    const record_uri = "at://did:plc:artist/fm.plyr.dev.track/track";
    try @import("../identity/postgres_actor_identity_store.zig").insertTestIdentity(
        pool,
        did,
        "artist.example",
        "Legacy Name",
        "https://legacy.example/avatar.jpg",
    );
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
        .image_url = "https://images.example/cover.jpg",
        .support_gate_type = "future-gate",
        .description = "verified description",
        .self_labels = &.{"self-note"},
        .proof = .{ .commit_cid = commit, .commit_rev = &rev.str(), .indexed_at_us = 1_000 },
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
            &rev.str(),
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
            .repository_rev = &rev.str(),
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
    try std.testing.expectEqual(@as(usize, 1), value.media.origins.len);
    try std.testing.expectEqualStrings("https://images.example/cover.jpg", value.media.artwork.?.url);
    try std.testing.expectEqual(track.Source.verified_repo, value.media.artwork.?.source);
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
                .repository_rev = &rev.str(),
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
            .proof = .{ .commit_cid = commit, .commit_rev = &rev.str(), .indexed_at_us = 1_000 },
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
            .proof = .{ .commit_cid = commit, .commit_rev = &rev.str(), .indexed_at_us = 1_000 },
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
            .proof = .{ .commit_cid = commit, .commit_rev = &rev.str(), .indexed_at_us = 1_000 },
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
            .proof = .{ .commit_cid = commit, .commit_rev = &rev.str(), .indexed_at_us = 1_000 },
        } },
    }) |like_change| {
        try std.testing.expectEqual(
            @import("../projection/like_store.zig").ApplyResult.applied,
            try like_writer.store().apply(a, like_change),
        );
    }
    const counted = (try implementation.store().getByUri(a, record_uri)).?;
    try std.testing.expectEqual(@as(i64, 1), counted.metrics.like_count);
    const liked = try implementation.likedStore().list(a, .{
        .actor_did = "did:plc:listenerone",
        .track_collection = "fm.plyr.dev.track",
        .limit = 2,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 1), liked.len);
    try std.testing.expectEqualStrings(record_uri, liked[0].value.record.uri);
    try std.testing.expectEqualStrings(
        "at://did:plc:listenerone/fm.plyr.dev.like/duplicate",
        liked[0].like_uri,
    );
    try std.testing.expectEqual(@as(usize, 0), (try implementation.likedStore().list(a, .{
        .actor_did = "did:plc:listenertwo",
        .track_collection = "fm.plyr.dev.track",
        .limit = 2,
        .after = null,
    })).len);

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
    , .{ list_uri, list_cid, did, try commit.toString(a), &rev.str(), album_list_uri });
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
    try std.testing.expectEqual(@as(usize, 2), delivered.media.origins.len);
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
    try std.testing.expectEqual(@as(usize, 1), shared_origin.media.origins.len);
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
    try std.testing.expectEqual(@as(usize, 1), stale_delivery.media.origins.len);
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
    _ = try pool.exec("UPDATE plyr_index.track_tag_records SET tags=ARRAY['drone'],tags_present=true WHERE record_uri=$1", .{record_uri});
    _ = try pool.exec("UPDATE plyr_index.track_tag_records SET tags=ARRAY['ambient'],tags_present=true WHERE record_uri=$1", .{pds_only_uri});
    var quiet = pds_only;
    quiet.upsert.record_uri = "at://did:plc:artist/fm.plyr.dev.track/quiet";
    quiet.upsert.rkey = "quiet";
    quiet.upsert.tags = &.{"ambient"};
    quiet.upsert.tags_present = true;
    _ = try track_writer.store().apply(a, quiet);
    const catalog = try implementation.store().listTags(a, "fm.plyr.dev.track", 15);
    try std.testing.expectEqual(@as(usize, 2), catalog.len);
    try std.testing.expectEqualStrings("drone", catalog[0].name);
    try std.testing.expectEqual(@as(i64, 7), catalog[0].total_plays);
    try std.testing.expectEqual(@as(i64, 1), catalog[0].track_count);
    try std.testing.expectEqual(@as(i64, 2), catalog[1].track_count);
    _ = try pool.exec("DELETE FROM plyr_index.track_records WHERE record_uri=$1", .{quiet.upsert.record_uri});

    try std.testing.expectEqual(@as(i64, 1), catalog[0].sources.verified_repo);
    try std.testing.expectEqual(@as(i64, 0), catalog[0].sources.legacy_plyr);
    _ = try pool.exec("INSERT INTO plyr_index.legacy_track_tags(record_uri,observed_record_cid,tag,source_track_id,source_observed_at) VALUES ($1,$3,'legacy-only',1,now()),($1,$3,'drone',1,now()),($2,$3,'legacy-only',2,now()),($2,$3,'drone',2,now())", .{ record_uri, pds_only_uri, record_cid });
    try std.testing.expectEqual(@as(usize, 2), (try implementation.store().listTags(a, "fm.plyr.dev.track", 15)).len);
    _ = try track_writer.store().apply(a, pds_only);
    const inherited = try implementation.store().listTags(a, "fm.plyr.dev.track", 15);
    try std.testing.expectEqualStrings("drone", inherited[0].name);
    try std.testing.expectEqual(@as(i64, 2), inherited[0].track_count);
    try std.testing.expectEqual(@as(i64, 1), inherited[0].sources.verified_repo);
    try std.testing.expectEqual(@as(i64, 1), inherited[0].sources.legacy_plyr);
    const legacy_page = try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 10,
        .after = null,
        .tags = &.{"legacy-only"},
    });
    try std.testing.expectEqual(@as(usize, 1), legacy_page.len);
    try std.testing.expectEqualStrings(pds_only_uri, legacy_page[0].value.record.uri);
    const overlap = try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 10,
        .after = null,
        .tags = &.{ "drone", "legacy-only" },
    });
    try std.testing.expectEqual(@as(usize, 2), overlap.len);
    _ = try pool.exec("UPDATE plyr_index.track_tag_records SET tags_present=true,tags='{}' WHERE record_uri=$1", .{pds_only_uri});
    try std.testing.expectEqual(@as(usize, 0), (try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 10,
        .after = null,
        .tags = &.{"legacy-only"},
    })).len);
    _ = try pool.exec("UPDATE plyr_index.track_tag_records SET tags_present=false WHERE record_uri=$1", .{pds_only_uri});
    _ = try pool.exec("UPDATE plyr_index.legacy_track_tags SET observed_record_cid=$2 WHERE record_uri=$1", .{ pds_only_uri, stale_subject_cid });
    try std.testing.expectEqual(@as(usize, 0), (try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 10,
        .after = null,
        .tags = &.{"legacy-only"},
    })).len);
    _ = try pool.exec("UPDATE plyr_index.legacy_track_tags SET observed_record_cid=$2 WHERE record_uri=$1", .{ pds_only_uri, record_cid });
    _ = try pool.exec("DELETE FROM plyr_index.track_tag_records WHERE record_uri=$1", .{pds_only_uri});
    try std.testing.expectEqual(@as(usize, 0), (try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 10,
        .after = null,
        .tags = &.{"legacy-only"},
    })).len);
    _ = try track_writer.store().apply(a, pds_only);
    _ = try pool.exec("DELETE FROM plyr_index.legacy_track_tags", .{});
    _ = try pool.exec("UPDATE plyr_index.track_tag_records SET tags_present=true,tags=ARRAY['ambient'] WHERE record_uri=$1", .{pds_only_uri});
    const tagged_page = try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 1,
        .after = null,
        .tags = &.{ "DRONE", "ambient" },
    });
    try std.testing.expectEqual(@as(usize, 1), tagged_page.len);
    const tagged_after: @FieldType(store_module.ListRequest, "after") = .{ .created_at_us = tagged_page[0].created_at_us, .at_uri = tagged_page[0].value.record.uri };
    for ([_]store_module.ListScope{ .discovery, .{ .artist = did } }) |scope| {
        const tagged_rest = try implementation.store().listPublic(a, .{
            .collection = "fm.plyr.dev.track",
            .scope = scope,
            .limit = 2,
            .after = tagged_after,
            .tags = &.{ "ambient", "drone" },
        });
        try std.testing.expectEqual(@as(usize, 1), tagged_rest.len);
        try std.testing.expect(!std.mem.eql(u8, tagged_page[0].value.record.uri, tagged_rest[0].value.record.uri));
    }
    _ = try pool.exec("UPDATE plyr_index.track_tag_records SET record_cid=$2 WHERE record_uri=$1", .{ record_uri, stale_subject_cid });
    try std.testing.expectEqual(@as(usize, 1), (try implementation.store().listTags(a, "fm.plyr.dev.track", 15)).len);
    try std.testing.expectEqual(@as(usize, 0), (try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 2,
        .after = null,
        .tags = &.{"drone"},
    })).len);
    _ = try pool.exec("UPDATE plyr_index.track_tag_records SET record_cid=$2 WHERE record_uri=$1", .{ record_uri, record_cid });
    _ = try pool.exec("UPDATE plyr_index.track_policies SET visibility='private' WHERE record_uri=$1", .{record_uri});
    try std.testing.expectEqual(@as(usize, 1), (try implementation.store().listTags(a, "fm.plyr.dev.track", 15)).len);
    _ = try pool.exec("UPDATE plyr_index.track_policies SET visibility='public',moderation_decision='exclude' WHERE record_uri=$1", .{record_uri});
    try std.testing.expectEqual(@as(usize, 1), (try implementation.store().listTags(a, "fm.plyr.dev.track", 15)).len);
    _ = try pool.exec("UPDATE plyr_index.track_policies SET moderation_decision='allow' WHERE record_uri=$1", .{record_uri});
    _ = try availability_writer.store().apply(a, .{
        .repo_did = did,
        .available = false,
        .reason = .deactivated,
        .source = .current_pds,
        .pds_origin = "https://pds.example",
        .observed_at_us = 1_001,
    });
    try std.testing.expectEqual(@as(usize, 0), (try implementation.store().listTags(a, "fm.plyr.dev.track", 15)).len);
    _ = try availability_writer.store().apply(a, .{
        .repo_did = did,
        .available = true,
        .source = .verified_repository,
        .repository_rev = &rev.str(),
        .commit_cid = commit,
        .observed_at_us = 1_002,
    });
    const after: @FieldType(store_module.ListRequest, "after") = .{ .created_at_us = page[0].created_at_us, .at_uri = page[0].value.record.uri };
    for ([_]store_module.ListScope{ .discovery, .{ .artist = did } }) |scope| {
        const rest = try implementation.store().listPublic(a, .{
            .collection = "fm.plyr.dev.track",
            .scope = scope,
            .limit = 2,
            .after = after,
        });
        try std.testing.expectEqual(@as(usize, 1), rest.len);
        try std.testing.expectEqualStrings(page[1].value.record.uri, rest[0].value.record.uri);
    }
    // Postgres has no year 0; the trigger stores NULL and the list skips the row
    _ = try pool.exec(
        "UPDATE plyr_index.track_records SET record_created_at = '0000-01-01T00:00:00Z' WHERE record_uri = $1",
        .{page[0].value.record.uri},
    );
    const without = try implementation.store().listPublic(a, .{
        .collection = "fm.plyr.dev.track",
        .scope = .discovery,
        .limit = 2,
        .after = null,
    });
    try std.testing.expectEqual(@as(usize, 1), without.len);
    try std.testing.expectEqualStrings(page[1].value.record.uri, without[0].value.record.uri);
    _ = try pool.exec(
        "UPDATE plyr_index.track_records SET record_created_at = $2 WHERE record_uri = $1",
        .{ page[0].value.record.uri, page[0].value.metadata.created_at },
    );
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
    _ = try availability_writer.store().apply(a, .{
        .repo_did = did,
        .available = true,
        .source = .verified_repository,
        .repository_rev = &rev.str(),
        .commit_cid = commit,
        .observed_at_us = 3_000,
    });
    _ = try pool.exec(
        \\INSERT INTO plyr_index.track_records(record_uri, record_cid, owner_did, collection, rkey,
        \\  title, artist_name, file_type, record_created_at, audio_url, deleted, commit_cid, commit_rev, indexed_at_us)
        \\SELECT 'at://did:plc:artist/fm.plyr.dev.track/noise-' || n, $1, 'did:plc:artist',
        \\  'fm.plyr.dev.track', 'noise-' || n, 'Noise', 'Artist', 'mp3',
        \\  '2026-08-08T11:00:00Z', 'https://media.example/noise', false, $2, $3, 1
        \\FROM generate_series(1, 10000) n
    , .{ record_cid, try commit.toString(a), &rev.str() });
    _ = try pool.exec("INSERT INTO plyr_index.track_tag_records SELECT record_uri,record_cid,ARRAY['noise'],true FROM plyr_index.track_records WHERE rkey LIKE 'noise-%'", .{});
    _ = try pool.exec("ANALYZE plyr_index.track_records", .{});
    _ = try pool.exec("ANALYZE plyr_index.track_tag_records", .{});
    var plan = (try pool.row("EXPLAIN (ANALYZE, FORMAT JSON) " ++ discovery_query, .{ "fm.plyr.dev.track", "fm.plyr.dev.actor.profile", "fm.plyr.dev.like", &[_][]const u8{"ambient"}, @as(i64, 2) })).?;
    const plan_json = try plan.get([]const u8, 0);
    if (std.mem.indexOf(u8, plan_json, "ix_track_tag_records_tags") == null) std.debug.print("tag query plan: {s}\n", .{plan_json});
    try std.testing.expect(std.mem.indexOf(u8, plan_json, "ix_track_tag_records_tags") != null);
    try plan.deinit();
    _ = try pool.exec("INSERT INTO plyr_index.legacy_track_tags(record_uri,observed_record_cid,tag,source_track_id,source_observed_at) SELECT record_uri,record_cid,'annotation-noise',1,now() FROM plyr_index.track_records WHERE rkey LIKE 'noise-%'", .{});
    _ = try pool.exec("INSERT INTO plyr_index.legacy_track_tags(record_uri,observed_record_cid,tag,source_track_id,source_observed_at) VALUES ($1,$2,'legacy-target',1,now())", .{ pds_only_uri, record_cid });
    _ = try pool.exec("UPDATE plyr_index.track_tag_records SET tags_present=false,tags='{}' WHERE record_uri=$1", .{pds_only_uri});
    _ = try pool.exec("ANALYZE plyr_index.legacy_track_tags", .{});
    var legacy_plan = (try pool.row("EXPLAIN (ANALYZE, FORMAT JSON) " ++ discovery_query, .{ "fm.plyr.dev.track", "fm.plyr.dev.actor.profile", "fm.plyr.dev.like", &[_][]const u8{"legacy-target"}, @as(i64, 2) })).?;
    const legacy_plan_json = try legacy_plan.get([]const u8, 0);
    if (std.mem.indexOf(u8, legacy_plan_json, "ix_legacy_track_tags_tag") == null) std.debug.print("legacy tag query plan: {s}\n", .{legacy_plan_json});
    try std.testing.expect(std.mem.indexOf(u8, legacy_plan_json, "ix_legacy_track_tags_tag") != null);
    try legacy_plan.deinit();
    var unfiltered_plan = (try pool.row("EXPLAIN (FORMAT JSON) " ++ discovery_query, .{ "fm.plyr.dev.track", "fm.plyr.dev.actor.profile", "fm.plyr.dev.like", &[_][]const u8{}, @as(i64, 2) })).?;
    const unfiltered_json = try unfiltered_plan.get([]const u8, 0);
    try std.testing.expect(std.mem.indexOf(u8, unfiltered_json, "legacy_track_tags") == null);
    try std.testing.expect(std.mem.indexOf(u8, unfiltered_json, "track_tag_records") == null);
    try unfiltered_plan.deinit();
}

fn requireDisposableDatabase(pool: *pg.Pool, allocator: std.mem.Allocator) !void {
    var row = (try pool.row("SELECT current_database()", .{})).?;
    defer row.deinit() catch {};
    const database = try allocator.dupe(u8, try row.get([]const u8, 0));
    defer allocator.free(database);
    if (!std.mem.eql(u8, database, "zig_test")) return error.UnsafeTestDatabase;
}

const tags_query =
    \\SELECT tag.name, count(*)::bigint, COALESCE(sum(metrics.play_count), 0)::bigint,
    \\  count(*) FILTER (WHERE tag.source='verified_repo')::bigint,
    \\  count(*) FILTER (WHERE tag.source='legacy_plyr')::bigint
++ "\n" ++ page_from ++ "\n" ++ track_tag_sql.effective_rows ++
    \\ LEFT JOIN plyr_index.track_metrics metrics ON metrics.record_uri=v.record_uri
    \\ WHERE v.record_created_at_us IS NOT NULL
++ "\n" ++ discovery_policy ++
    \\ GROUP BY tag.name
    \\ ORDER BY COALESCE(sum(metrics.play_count),0) DESC, tag.name
    \\ LIMIT $2::bigint
;
