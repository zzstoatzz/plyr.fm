//! PostgreSQL adapter for verified public lists and exact member hydration.
//!
//! The list record and order come only from the authenticated repository
//! projection. Member tracks reuse the composed track decoder and are eligible
//! only on an exact URI/CID match under the same account, access, moderation,
//! and metrics policy as standalone track reads.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const verified_list = @import("../domain/verified_list.zig");
const album_id = @import("../identity/album_id.zig");
const playlist_id = @import("../identity/playlist_id.zig");
const store_module = @import("verified_list_store.zig");
const composed_track = @import("postgres_composed_track_store.zig");
const VerifiedListStore = store_module.VerifiedListStore;

pub const PostgresVerifiedListStore = struct {
    pool: *pg.Pool,
    like_collection: []const u8,

    pub fn store(self: *PostgresVerifiedListStore) VerifiedListStore {
        return .{
            .context = self,
            .list_by_owner_fn = listOpaque,
            .get_by_uri_fn = getOpaque,
        };
    }

    fn listOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.CollectionRequest,
    ) VerifiedListStore.Error![]store_module.CollectionItem {
        const self: *PostgresVerifiedListStore = @ptrCast(@alignCast(context));
        return self.listByOwner(allocator, request);
    }

    fn getOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.DetailRequest,
    ) VerifiedListStore.Error!?verified_list.Detail {
        const self: *PostgresVerifiedListStore = @ptrCast(@alignCast(context));
        return self.getByUri(allocator, request);
    }

    fn listByOwner(
        self: *PostgresVerifiedListStore,
        allocator: std.mem.Allocator,
        request: store_module.CollectionRequest,
    ) VerifiedListStore.Error![]store_module.CollectionItem {
        const limit: i64 = @intCast(request.limit);
        const conn = self.pool.acquire() catch |err| {
            std.log.err("verified list collection connection failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer self.pool.release(conn);
        var result = if (request.after) |after| blk: {
            break :blk conn.query(collection_after_query, .{
                request.collection,
                request.profile_collection,
                @tagName(request.kind),
                request.owner_did,
                after.created_at_us,
                after.at_uri,
                limit,
            }) catch |err| {
                logQueryError(conn, "verified list collection query failed", err);
                return error.IndexUnavailable;
            };
        } else blk: {
            break :blk conn.query(collection_query, .{
                request.collection,
                request.profile_collection,
                @tagName(request.kind),
                request.owner_did,
                limit,
            }) catch |err| {
                logQueryError(conn, "verified list collection query failed", err);
                return error.IndexUnavailable;
            };
        };
        defer result.deinit();

        var items: std.ArrayList(store_module.CollectionItem) = .empty;
        errdefer items.deinit(allocator);
        while (result.next() catch |err| {
            std.log.err("verified list collection read failed: {}", .{err});
            return error.IndexUnavailable;
        }) |row| {
            const decoded = decodeSummary(allocator, row, request.kind) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => {
                    std.log.err("verified list summary decode failed: {}", .{err});
                    return error.CorruptProjection;
                },
            };
            items.append(allocator, .{
                .value = decoded,
                .created_at_us = row.get(i64, 19) catch return error.CorruptProjection,
            }) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch return error.OutOfMemory;
    }

    fn getByUri(
        self: *PostgresVerifiedListStore,
        allocator: std.mem.Allocator,
        request: store_module.DetailRequest,
    ) VerifiedListStore.Error!?verified_list.Detail {
        const conn = self.pool.acquire() catch |err| {
            std.log.err("verified list detail connection failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer self.pool.release(conn);
        var result = conn.query(detail_query, .{
            request.uri,
            request.list_collection,
            request.track_collection,
            request.profile_collection,
            @tagName(request.kind),
            self.like_collection,
        }) catch |err| {
            logQueryError(conn, "verified list detail query failed", err);
            return error.IndexUnavailable;
        };
        defer result.deinit();

        var header: ?Header = null;
        var members: std.ArrayList(verified_list.Member) = .empty;
        errdefer members.deinit(allocator);
        var available_count: usize = 0;
        var total_plays: i64 = 0;
        while (result.next() catch |err| {
            std.log.err("verified list detail read failed: {}", .{err});
            return error.IndexUnavailable;
        }) |row| {
            if (header == null) {
                header = decodeHeader(allocator, row, request.kind, request.uri) catch |err| switch (err) {
                    error.OutOfMemory => return error.OutOfMemory,
                    else => {
                        std.log.err("verified list header decode failed: {}", .{err});
                        return error.CorruptProjection;
                    },
                };
            } else if (!std.mem.eql(
                u8,
                header.?.record.uri,
                row.get([]const u8, 0) catch return error.CorruptProjection,
            )) return error.CorruptProjection;

            const position = row.get(?i16, 16) catch return error.CorruptProjection;
            if (position == null) {
                if (members.items.len != 0 or
                    (row.get(?[]const u8, 17) catch return error.CorruptProjection) != null or
                    (row.get(?[]const u8, 18) catch return error.CorruptProjection) != null)
                    return error.CorruptProjection;
                continue;
            }
            if (position.? < 0 or @as(usize, @intCast(position.?)) != members.items.len)
                return error.CorruptProjection;
            const subject_uri = try duplicate(
                allocator,
                row.get([]const u8, 17) catch return error.CorruptProjection,
            );
            validateRecordUri(subject_uri, request.track_collection) catch
                return error.CorruptProjection;
            const subject_cid = try duplicate(
                allocator,
                row.get([]const u8, 18) catch return error.CorruptProjection,
            );
            validateCid(allocator, subject_cid, zat.cbor.Codec.dag_cbor) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            };

            const is_available = row.get(bool, 19) catch return error.CorruptProjection;
            const resolved = if (is_available)
                composed_track.decodeRow(allocator, shiftedRow(row, 20)) catch |err| switch (err) {
                    error.OutOfMemory => return error.OutOfMemory,
                    else => return error.CorruptProjection,
                }
            else
                null;
            if (resolved) |track| {
                if (!std.mem.eql(u8, track.record.uri, subject_uri) or
                    track.record.cid == null or !std.mem.eql(u8, track.record.cid.?, subject_cid))
                    return error.CorruptProjection;
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

        const value = header orelse return null;
        const owned_members = members.toOwnedSlice(allocator) catch return error.OutOfMemory;
        return .{
            .object = value.kind,
            .id = value.id,
            .record = value.record,
            .metadata = value.metadata,
            .owner = value.owner,
            .members = owned_members,
            .metrics = .{
                .member_count = owned_members.len,
                .available_count = available_count,
                .total_plays = total_plays,
            },
            .sources = value.sources,
            .projection = value.projection,
        };
    }
};

fn logQueryError(conn: *pg.Conn, message: []const u8, err: anyerror) void {
    if (conn.err) |pg_err|
        std.log.err("{s}: {}: {s}", .{ message, err, pg_err.message })
    else
        std.log.err("{s}: {}", .{ message, err });
}

/// Adapter that presents a wider pg row as though the composed track fields
/// began at column zero. Keeping this tiny boundary avoids a second decoder.
fn shiftedRow(row: anytype, comptime base: usize) ShiftedRow(@TypeOf(row), base) {
    return .{ .row = row };
}

fn ShiftedRow(comptime Row: type, comptime base: usize) type {
    return struct {
        row: Row,
        pub fn get(self: @This(), comptime T: type, index: usize) !T {
            return self.row.get(T, base + index);
        }
    };
}

const Header = struct {
    kind: verified_list.Kind,
    id: []const u8,
    record: verified_list.Record,
    metadata: verified_list.Metadata,
    owner: verified_list.Owner,
    sources: verified_list.Sources,
    projection: verified_list.Projection,
};

fn decodeSummary(
    allocator: std.mem.Allocator,
    row: anytype,
    kind: verified_list.Kind,
) !verified_list.Summary {
    const header = try decodeHeader(allocator, row, kind, null);
    const member_count = try nonnegativeUsize(try row.get(i64, 16));
    const available_count = try nonnegativeUsize(try row.get(i64, 17));
    if (available_count > member_count) return error.CorruptMetrics;
    const total_plays = try row.get(i64, 18);
    if (total_plays < 0) return error.CorruptMetrics;
    return .{
        .object = kind,
        .id = header.id,
        .record = header.record,
        .metadata = header.metadata,
        .owner = header.owner,
        .metrics = .{
            .member_count = member_count,
            .available_count = available_count,
            .total_plays = total_plays,
        },
        .sources = header.sources,
        .projection = header.projection,
    };
}

fn decodeHeader(
    allocator: std.mem.Allocator,
    row: anytype,
    kind: verified_list.Kind,
    expected_uri: ?[]const u8,
) !Header {
    const uri = try duplicate(allocator, try row.get([]const u8, 0));
    if (expected_uri) |expected| {
        if (!std.mem.eql(u8, uri, expected)) return error.CorruptListUri;
    }
    const parsed = zat.AtUri.parse(uri) orelse return error.CorruptListUri;
    const owner_did = try duplicate(allocator, try row.get([]const u8, 2));
    const collection = try duplicate(allocator, try row.get([]const u8, 3));
    const rkey = try duplicate(allocator, try row.get([]const u8, 4));
    if (!std.mem.eql(u8, parsed.authority(), owner_did) or
        !std.mem.eql(u8, parsed.collection() orelse return error.CorruptListUri, collection) or
        !std.mem.eql(u8, parsed.rkey() orelse return error.CorruptListUri, rkey))
        return error.CorruptListUri;
    const record_cid = try duplicate(allocator, try row.get([]const u8, 1));
    try validateCid(allocator, record_cid, zat.cbor.Codec.dag_cbor);
    const commit_cid = try duplicate(allocator, try row.get([]const u8, 8));
    try validateCid(allocator, commit_cid, zat.cbor.Codec.dag_cbor);
    const commit_rev = try duplicate(allocator, try row.get([]const u8, 9));
    const indexed_at_us = try row.get(i64, 10);
    if (zat.Tid.parse(commit_rev) == null or indexed_at_us < 0)
        return error.CorruptProof;

    const handle = try duplicateOptional(allocator, try row.get(?[]const u8, 11));
    const display_name = try duplicateOptional(allocator, try row.get(?[]const u8, 12));
    const avatar = try duplicateOptional(allocator, try row.get(?[]const u8, 13));
    if ((handle == null) != (display_name == null)) return error.CorruptOwnerProfile;
    if (handle) |value| {
        if (zat.Handle.parse(value) == null) return error.CorruptOwnerProfile;
    } else if (avatar != null) return error.CorruptOwnerProfile;
    const authored_avatar = try row.get(bool, 14);
    if (authored_avatar and avatar == null) return error.CorruptOwnerProfile;
    const account_source = try parseAccountSource(try row.get([]const u8, 15));
    const id = try allocator.alloc(u8, switch (kind) {
        .album => album_id.encodedLength(uri),
        .playlist => playlist_id.encodedLength(uri),
    });
    _ = switch (kind) {
        .album => try album_id.encode(id, uri),
        .playlist => try playlist_id.encode(id, uri),
    };
    return .{
        .kind = kind,
        .id = id,
        .record = .{ .uri = uri, .cid = record_cid, .collection = collection, .rkey = rkey },
        .metadata = .{
            .name = try duplicateOptional(allocator, try row.get(?[]const u8, 5)),
            .created_at = try duplicate(allocator, try row.get([]const u8, 6)),
            .updated_at = try duplicateOptional(allocator, try row.get(?[]const u8, 7)),
        },
        .owner = .{
            .did = owner_did,
            .profile = if (handle) |present_handle| .{
                .handle = present_handle,
                .display_name = display_name.?,
                .avatar_url = avatar,
            } else null,
        },
        .sources = .{
            .owner_profile = if (handle == null) .derived else if (authored_avatar) .mixed else .legacy_projection,
            .metrics = .derived,
            .account_availability = account_source,
        },
        .projection = .{
            .commit_cid = commit_cid,
            .commit_rev = commit_rev,
            .indexed_at_us = indexed_at_us,
        },
    };
}

fn parseAccountSource(value: []const u8) !@import("../domain/track.zig").Source {
    if (std.mem.eql(u8, value, "verified_repository")) return .verified_repo;
    if (std.mem.eql(u8, value, "current_pds")) return .current_pds;
    return error.CorruptAccountSource;
}

fn nonnegativeUsize(value: i64) !usize {
    if (value < 0) return error.CorruptMetrics;
    return std.math.cast(usize, value) orelse error.CorruptMetrics;
}

fn validateRecordUri(uri: []const u8, expected_collection: []const u8) !void {
    const parsed = zat.AtUri.parse(uri) orelse return error.CorruptMemberUri;
    if (zat.Did.parse(parsed.authority()) == null or parsed.rkey() == null or
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

const header_columns =
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
    \\  lower(owner_a.handle),
    \\  owner_a.display_name,
    \\  COALESCE(owner_p.avatar, owner_a.avatar_url),
    \\  owner_p.avatar IS NOT NULL,
    \\  owner_aa.evidence_source
;

const collection_joins =
    \\FROM plyr_index.list_records AS records
    \\JOIN plyr_index.account_availability AS owner_aa
    \\  ON owner_aa.repo_did = records.owner_did AND owner_aa.available
    \\LEFT JOIN artists AS owner_a
    \\  ON owner_a.did = records.owner_did AND NOT owner_a.deactivated
    \\LEFT JOIN plyr_index.profile_records AS owner_p
    \\  ON owner_p.owner_did = records.owner_did AND owner_p.collection = $2
    \\  AND owner_p.rkey = 'self' AND NOT owner_p.deleted
    \\LEFT JOIN plyr_index.list_members AS members
    \\  ON members.list_uri = records.record_uri
    \\LEFT JOIN plyr_index.track_policies AS pol
    \\  ON pol.record_uri = members.track_uri
    \\LEFT JOIN plyr_index.track_records AS v
    \\  ON v.record_uri = members.track_uri AND v.record_cid = members.track_cid
    \\  AND NOT v.deleted AND COALESCE(pol.visibility, 'public') <> 'private'
    \\  AND pol.moderation_decision IS DISTINCT FROM 'exclude'
    \\  AND (
    \\    pol.moderation_decision IS NOT DISTINCT FROM 'allow'
    \\    OR NOT (
    \\      v.self_labels && ARRAY['copyright-violation']::text[]
    \\      OR COALESCE(pol.operator_labels, '[]'::jsonb) ?| ARRAY['copyright-violation']
    \\    )
    \\  )
    \\LEFT JOIN plyr_index.account_availability AS aa
    \\  ON aa.repo_did = v.owner_did AND aa.available
    \\LEFT JOIN artists AS a ON a.did = v.owner_did AND NOT a.deactivated
    \\LEFT JOIN plyr_index.track_metrics AS metrics
    \\  ON metrics.record_uri = v.record_uri
;

const collection_select = "SELECT\n" ++ header_columns ++ "\n" ++
    \\  , count(members.position)::bigint
    \\  , count(v.record_uri) FILTER (WHERE aa.repo_did IS NOT NULL AND a.did IS NOT NULL)::bigint
    \\  , COALESCE(sum(COALESCE(metrics.play_count, 0)) FILTER (
    \\      WHERE aa.repo_did IS NOT NULL AND a.did IS NOT NULL
    \\    ), 0)::bigint
    \\  , (extract(epoch FROM records.record_created_at::timestamptz) * 1000000)::bigint
;

const collection_where =
    \\WHERE records.collection = $1 AND records.list_type = $3
    \\  AND ($4::text IS NULL OR records.owner_did = $4) AND NOT records.deleted
;

const collection_group =
    \\GROUP BY records.record_uri, owner_aa.evidence_source, owner_a.did, owner_p.record_uri
;

const collection_query = collection_select ++ "\n" ++ collection_joins ++ "\n" ++
    collection_where ++ "\n" ++ collection_group ++ "\n" ++
    \\ORDER BY records.record_created_at::timestamptz DESC, records.record_uri DESC
    \\LIMIT $5::bigint
;

const collection_after_query = collection_select ++ "\n" ++ collection_joins ++ "\n" ++
    collection_where ++ "\n" ++
    \\  AND (
    \\    records.record_created_at::timestamptz < TIMESTAMPTZ 'epoch' + ($5::bigint * INTERVAL '1 microsecond')
    \\    OR (records.record_created_at::timestamptz = TIMESTAMPTZ 'epoch' + ($5::bigint * INTERVAL '1 microsecond')
    \\      AND records.record_uri < $6)
    \\  )
++ "\n" ++ collection_group ++ "\n" ++
    \\ORDER BY records.record_created_at::timestamptz DESC, records.record_uri DESC
    \\LIMIT $7::bigint
;

const detail_query = "SELECT\n" ++ header_columns ++ "\n" ++
    \\  , members.position
    \\  , members.track_uri
    \\  , members.track_cid
    \\  , (v.record_uri IS NOT NULL AND aa.repo_did IS NOT NULL AND a.did IS NOT NULL)
    \\  ,
++ composed_track.projected_columns ++ "\n" ++
    \\FROM plyr_index.list_records AS records
    \\JOIN plyr_index.account_availability AS owner_aa
    \\  ON owner_aa.repo_did = records.owner_did AND owner_aa.available
    \\LEFT JOIN artists AS owner_a
    \\  ON owner_a.did = records.owner_did AND NOT owner_a.deactivated
    \\LEFT JOIN plyr_index.profile_records AS owner_p
    \\  ON owner_p.owner_did = records.owner_did AND owner_p.collection = $4
    \\  AND owner_p.rkey = 'self' AND NOT owner_p.deleted
    \\LEFT JOIN plyr_index.list_members AS members
    \\  ON members.list_uri = records.record_uri
    \\LEFT JOIN plyr_index.track_policies AS pol
    \\  ON pol.record_uri = members.track_uri
    \\LEFT JOIN plyr_index.track_records AS v
    \\  ON v.record_uri = members.track_uri AND v.record_cid = members.track_cid
    \\  AND v.collection = $3 AND NOT v.deleted
    \\  AND COALESCE(pol.visibility, 'public') <> 'private'
    \\  AND pol.moderation_decision IS DISTINCT FROM 'exclude'
    \\  AND (
    \\    pol.moderation_decision IS NOT DISTINCT FROM 'allow'
    \\    OR NOT (
    \\      v.self_labels && ARRAY['copyright-violation']::text[]
    \\      OR COALESCE(pol.operator_labels, '[]'::jsonb) ?| ARRAY['copyright-violation']
    \\    )
    \\  )
    \\LEFT JOIN plyr_index.account_availability AS aa
    \\  ON aa.repo_did = v.owner_did AND aa.available
    \\LEFT JOIN tracks AS t ON t.atproto_record_uri = v.record_uri
    \\LEFT JOIN plyr_index.track_delivery_origins AS d
    \\  ON d.record_uri = v.record_uri AND d.record_cid = v.record_cid
    \\  AND d.service = 'r2' AND d.verification = 'verified_blob_cid'
    \\LEFT JOIN plyr_index.track_metrics AS metrics
    \\  ON metrics.record_uri = v.record_uri
    \\LEFT JOIN LATERAL (
    \\  SELECT count(DISTINCT likes.owner_did)::bigint AS like_count
    \\  FROM plyr_index.like_records AS likes
    \\  JOIN plyr_index.account_availability AS liker_account
    \\    ON liker_account.repo_did = likes.owner_did AND liker_account.available
    \\  WHERE likes.subject_uri = v.record_uri AND likes.subject_cid = v.record_cid
    \\    AND likes.collection = $6 AND NOT likes.deleted
    \\) AS like_metrics ON true
    \\LEFT JOIN artists AS a ON a.did = v.owner_did AND NOT a.deactivated
    \\LEFT JOIN plyr_index.profile_records AS p
    \\  ON p.owner_did = v.owner_did AND p.collection = $4
    \\  AND p.rkey = 'self' AND NOT p.deleted
    \\WHERE records.record_uri = $1 AND records.collection = $2
    \\  AND records.list_type = $5 AND NOT records.deleted
    \\ORDER BY members.position
;
