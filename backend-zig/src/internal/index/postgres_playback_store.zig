//! PostgreSQL adapter for playback capabilities.
//!
//! This deliberately does not join the legacy track table. Admission and the
//! author-declared fallback come from an authenticated record; exact R2 evidence
//! comes from a record-CID-bound delivery projection.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const playback = @import("../domain/playback.zig");
const PlaybackStore = @import("playback_store.zig").PlaybackStore;

pub const PostgresPlaybackStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresPlaybackStore) PlaybackStore {
        return .{ .context = self, .get_by_uri_fn = getOpaque };
    }

    fn getOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        at_uri: []const u8,
    ) PlaybackStore.Error!?playback.Candidate {
        const self: *PostgresPlaybackStore = @ptrCast(@alignCast(context));
        return self.get(allocator, at_uri);
    }

    fn get(
        self: *PostgresPlaybackStore,
        allocator: std.mem.Allocator,
        at_uri: []const u8,
    ) PlaybackStore.Error!?playback.Candidate {
        const conn = self.pool.acquire() catch |err| {
            std.log.err("playback connection failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer self.pool.release(conn);
        var query_row = conn.row(query, .{at_uri}) catch |err| {
            logQueryError(conn, "playback query failed", err);
            return error.IndexUnavailable;
        } orelse return null;
        var active = true;
        defer if (active) forceReleaseQueryRow(&query_row);
        const value = decode(allocator, at_uri, &query_row.row) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => {
                std.log.err("playback projection decode failed: {}", .{err});
                return error.CorruptProjection;
            },
        };
        finishQueryRow(&query_row) catch |err| {
            std.log.err("playback result cleanup failed: {}", .{err});
            active = false;
            return error.IndexUnavailable;
        };
        active = false;
        return value;
    }
};

fn decode(
    allocator: std.mem.Allocator,
    expected_uri: []const u8,
    row: anytype,
) !playback.Candidate {
    const record_uri = try duplicate(allocator, try row.get([]const u8, 0));
    if (!std.mem.eql(u8, expected_uri, record_uri)) return error.CorruptRecordUri;
    const parsed_uri = zat.AtUri.parse(record_uri) orelse return error.CorruptRecordUri;
    if (parsed_uri.collection() == null or parsed_uri.rkey() == null)
        return error.CorruptRecordUri;

    const record_cid = try duplicate(allocator, try row.get([]const u8, 1));
    try validateCid(allocator, record_cid, zat.cbor.Codec.dag_cbor);
    const revision = try duplicate(allocator, try row.get([]const u8, 2));
    if (zat.Tid.parse(revision) == null) return error.CorruptRevision;
    const visibility = std.meta.stringToEnum(
        playback.Visibility,
        try row.get([]const u8, 3),
    ) orelse return error.CorruptVisibility;
    const gate_type = try duplicateOptional(allocator, try row.get(?[]const u8, 4));

    const blob_cid = try duplicateOptional(allocator, try row.get(?[]const u8, 5));
    const blob_media_type = try duplicateOptional(allocator, try row.get(?[]const u8, 6));
    const blob_size = try row.get(?i64, 7);
    if ((blob_cid == null) != (blob_media_type == null) or
        (blob_cid == null and blob_size != null) or
        (blob_size != null and blob_size.? < 0))
        return error.CorruptArtifact;
    if (blob_cid) |cid| try validateCid(allocator, cid, zat.cbor.Codec.raw);
    const artifact: ?playback.Artifact = if (blob_cid) |cid| .{
        .cid = cid,
        .media_type = blob_media_type.?,
        .byte_length = blob_size,
    } else null;

    const authored_url = try duplicateOptional(allocator, try row.get(?[]const u8, 8));
    const authored_media_type = try duplicate(allocator, try row.get([]const u8, 9));
    const authored_delivery: ?playback.Delivery = if (authored_url) |url|
        if (supportedDeliveryUrl(url)) .{
            .url = url,
            .media_type = authored_media_type,
            .artifact_cid = null,
            .source = .authored_record,
            .integrity = .unverified,
        } else null
    else
        null;

    const delivery_url = try duplicateOptional(allocator, try row.get(?[]const u8, 10));
    const delivery_media_type = try duplicateOptional(allocator, try row.get(?[]const u8, 11));
    const delivery_artifact_cid = try duplicateOptional(allocator, try row.get(?[]const u8, 12));
    if ((delivery_url == null) != (delivery_media_type == null) or
        (delivery_url == null) != (delivery_artifact_cid == null))
        return error.CorruptDelivery;
    const verified_delivery: ?playback.Delivery = if (delivery_url) |url| blk: {
        if (!supportedDeliveryUrl(url)) return error.CorruptDelivery;
        const cid = delivery_artifact_cid.?;
        try validateCid(allocator, cid, zat.cbor.Codec.raw);
        if (blob_cid == null or !std.mem.eql(u8, blob_cid.?, cid) or
            !std.mem.eql(u8, blob_media_type.?, delivery_media_type.?))
            return error.CorruptDelivery;
        break :blk .{
            .url = url,
            .media_type = delivery_media_type.?,
            .artifact_cid = cid,
            .source = .verified_delivery,
            .integrity = .verified_blob_cid,
        };
    } else null;

    return .{
        .record_uri = record_uri,
        .record_cid = record_cid,
        .revision = revision,
        .visibility = visibility,
        .gate_type = gate_type,
        .artifact = artifact,
        .verified_delivery = verified_delivery,
        .authored_delivery = authored_delivery,
    };
}

fn supportedDeliveryUrl(value: []const u8) bool {
    const uri = std.Uri.parse(value) catch return false;
    return std.ascii.eqlIgnoreCase(uri.scheme, "https") and
        uri.host != null and uri.user == null and uri.password == null and
        uri.fragment == null;
}

fn validateCid(allocator: std.mem.Allocator, value: []const u8, codec: u64) !void {
    const parsed = try zat.Cid.fromString(allocator, value);
    defer allocator.free(parsed.raw);
    if (parsed.codec() != codec) return error.InvalidCidCodec;
}

fn logQueryError(conn: *pg.Conn, message: []const u8, err: anyerror) void {
    if (conn.err) |pg_err|
        std.log.err("{s}: {}: {s}", .{ message, err, pg_err.message })
    else
        std.log.err("{s}: {}", .{ message, err });
}

fn finishQueryRow(query_row: *pg.QueryRow) !void {
    query_row.deinit() catch |err| {
        query_row.result.deinit();
        return err;
    };
}

fn forceReleaseQueryRow(query_row: *pg.QueryRow) void {
    finishQueryRow(query_row) catch |err|
        std.log.err("forced playback result cleanup: {}", .{err});
}

fn duplicate(allocator: std.mem.Allocator, value: []const u8) ![]const u8 {
    return allocator.dupe(u8, value);
}

fn duplicateOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |present| try duplicate(allocator, present) else null;
}

const query =
    \\SELECT
    \\  v.record_uri,
    \\  v.record_cid,
    \\  v.commit_rev,
    \\  COALESCE(pol.visibility, 'public'),
    \\  v.support_gate_type,
    \\  v.audio_blob_cid,
    \\  v.audio_blob_media_type,
    \\  v.audio_blob_size,
    \\  v.audio_url,
    \\  v.file_type,
    \\  d.origin_url,
    \\  d.media_type,
    \\  d.artifact_cid
    \\FROM plyr_index.track_records AS v
    \\JOIN plyr_index.account_availability AS aa
    \\  ON aa.repo_did = v.owner_did AND aa.available
    \\LEFT JOIN plyr_index.track_policies AS pol
    \\  ON pol.record_uri = v.record_uri
    \\LEFT JOIN plyr_index.track_delivery_origins AS d
    \\  ON d.record_uri = v.record_uri AND d.record_cid = v.record_cid
    \\  AND d.service = 'r2' AND d.verification = 'verified_blob_cid'
    \\WHERE v.record_uri = $1
    \\  AND NOT v.deleted
    \\  AND COALESCE(pol.visibility, 'public') <> 'private'
    \\  AND pol.moderation_decision IS DISTINCT FROM 'exclude'
    \\  AND (
    \\    pol.moderation_decision IS NOT DISTINCT FROM 'allow'
    \\    OR NOT (
    \\      v.self_labels && ARRAY['copyright-violation']::text[]
    \\      OR COALESCE(pol.operator_labels, '[]'::jsonb) ?| ARRAY['copyright-violation']
    \\    )
    \\  )
    \\LIMIT 1
;

test "playback delivery URLs require safe HTTPS origins" {
    try std.testing.expect(supportedDeliveryUrl("https://audio.example/track.mp3"));
    try std.testing.expect(!supportedDeliveryUrl("http://audio.example/track.mp3"));
    try std.testing.expect(!supportedDeliveryUrl("https://user:pass@audio.example/track.mp3"));
    try std.testing.expect(!supportedDeliveryUrl("did:plc:artist"));
}
