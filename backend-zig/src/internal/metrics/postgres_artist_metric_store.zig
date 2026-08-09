//! PostgreSQL adapter for public artist aggregates.
//!
//! Authenticated repository records define catalog membership and duration;
//! application-owned canonical metrics define plays. Legacy track IDs, counts,
//! and timestamps never enter this read model.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const artist_metrics = @import("../domain/artist_metrics.zig");
const track_id = @import("../identity/track_id.zig");
const ArtistMetricStore = @import("artist_metric_store.zig").ArtistMetricStore;

pub const PostgresArtistMetricStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresArtistMetricStore) ArtistMetricStore {
        return .{ .context = self, .get_fn = getOpaque };
    }

    fn getOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        artist_did: []const u8,
        track_collection: []const u8,
    ) ArtistMetricStore.Error!artist_metrics.ArtistMetrics {
        const self: *PostgresArtistMetricStore = @ptrCast(@alignCast(context));
        return self.get(allocator, artist_did, track_collection);
    }

    fn get(
        self: *PostgresArtistMetricStore,
        allocator: std.mem.Allocator,
        artist_did: []const u8,
        track_collection: []const u8,
    ) ArtistMetricStore.Error!artist_metrics.ArtistMetrics {
        var query_row = self.pool.row(metrics_query, .{ artist_did, track_collection }) catch |err| {
            std.log.err("PostgreSQL artist metrics lookup failed: {}", .{err});
            return error.MetricsUnavailable;
        } orelse return error.CorruptMetrics;
        var active = true;
        defer if (active) forceReleaseQueryRow(&query_row);

        const value = decodeRow(allocator, artist_did, &query_row) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => {
                std.log.err("artist metrics projection decode failed: {}", .{err});
                return error.CorruptMetrics;
            },
        };
        finishQueryRow(&query_row) catch return error.MetricsUnavailable;
        active = false;
        return value;
    }

    fn decodeRow(
        allocator: std.mem.Allocator,
        artist_did: []const u8,
        row: anytype,
    ) !artist_metrics.ArtistMetrics {
        if (zat.Did.parse(artist_did) == null) return error.CorruptArtistDid;
        const track_count = try row.get(i64, 0);
        const total_duration = try row.get(i64, 1);
        const total_plays = try row.get(i64, 2);
        if (track_count < 0 or total_duration < 0 or total_plays < 0)
            return error.NegativeAggregate;

        const top_uri = try row.get(?[]const u8, 3);
        const top_cid = try row.get(?[]const u8, 4);
        const top_title = try row.get(?[]const u8, 5);
        const top_plays = try row.get(?i64, 6);
        const top: ?artist_metrics.TrackReference = if (top_uri) |uri| blk: {
            const cid = top_cid orelse return error.PartialTopTrack;
            const title = top_title orelse return error.PartialTopTrack;
            const plays = top_plays orelse return error.PartialTopTrack;
            if (plays < 0) return error.NegativeAggregate;
            const parsed_uri = zat.AtUri.parse(uri) orelse return error.CorruptTrackUri;
            if (!std.mem.eql(u8, parsed_uri.authority(), artist_did))
                return error.CorruptTrackUri;
            const parsed_cid = zat.Cid.fromString(allocator, cid) catch
                return error.CorruptTrackCid;
            defer allocator.free(parsed_cid.raw);
            if (parsed_cid.codec() != zat.cbor.Codec.dag_cbor)
                return error.CorruptTrackCid;
            const owned_uri = try allocator.dupe(u8, uri);
            const id_storage = try allocator.alloc(u8, track_id.encodedLength(owned_uri));
            const id = try track_id.encode(id_storage, owned_uri);
            break :blk .{
                .id = id,
                .record = .{
                    .uri = owned_uri,
                    .cid = try allocator.dupe(u8, cid),
                },
                .title = try allocator.dupe(u8, title),
                .play_count = plays,
            };
        } else blk: {
            if (top_cid != null or top_title != null or top_plays != null or track_count != 0)
                return error.PartialTopTrack;
            break :blk null;
        };

        return .{
            .artist_did = try allocator.dupe(u8, artist_did),
            .totals = .{
                .plays = total_plays,
                .tracks = track_count,
                .duration_seconds = total_duration,
            },
            .top_track = top,
        };
    }
};

const metrics_query =
    \\WITH admitted AS MATERIALIZED (
    \\  SELECT
    \\    v.record_uri,
    \\    v.record_cid,
    \\    v.title,
    \\    COALESCE(v.duration_seconds, 0)::bigint AS duration_seconds,
    \\    COALESCE(metrics.play_count, 0)::bigint AS play_count,
    \\    v.record_created_at
    \\  FROM plyr_index.track_records AS v
    \\  JOIN plyr_index.account_availability AS aa
    \\    ON aa.repo_did = v.owner_did AND aa.available
    \\  LEFT JOIN plyr_index.track_policies AS pol
    \\    ON pol.record_uri = v.record_uri
    \\  LEFT JOIN plyr_index.track_metrics AS metrics
    \\    ON metrics.record_uri = v.record_uri
    \\  WHERE v.owner_did = $1
    \\    AND v.collection = $2
    \\    AND NOT v.deleted
    \\    AND COALESCE(pol.visibility, 'public') <> 'private'
    \\    AND pol.moderation_decision IS DISTINCT FROM 'exclude'
    \\    AND (
    \\      pol.moderation_decision IS NOT DISTINCT FROM 'allow'
    \\      OR NOT (
    \\        v.self_labels && ARRAY['copyright-violation']::text[]
    \\        OR COALESCE(pol.operator_labels, '[]'::jsonb)
    \\          ?| ARRAY['copyright-violation']
    \\      )
    \\    )
    \\), aggregate AS (
    \\  SELECT
    \\    count(*)::bigint AS track_count,
    \\    COALESCE(sum(duration_seconds), 0)::bigint AS total_duration,
    \\    COALESCE(sum(play_count), 0)::bigint AS total_plays
    \\  FROM admitted
    \\), top_track AS (
    \\  SELECT record_uri, record_cid, title, play_count
    \\  FROM admitted
    \\  ORDER BY play_count DESC, record_created_at DESC, record_uri DESC
    \\  LIMIT 1
    \\)
    \\SELECT
    \\  aggregate.track_count,
    \\  aggregate.total_duration,
    \\  aggregate.total_plays,
    \\  top_track.record_uri,
    \\  top_track.record_cid,
    \\  top_track.title,
    \\  top_track.play_count
    \\FROM aggregate
    \\LEFT JOIN top_track ON true
;

fn finishQueryRow(query_row: *pg.QueryRow) !void {
    query_row.deinit() catch |err| {
        query_row.result.deinit();
        return err;
    };
}

fn forceReleaseQueryRow(query_row: *pg.QueryRow) void {
    finishQueryRow(query_row) catch |err|
        std.log.err("forced artist metrics result cleanup: {}", .{err});
}

test "PostgreSQL artist metrics aggregate only admitted canonical tracks" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const database_url = std.mem.span(url_z);
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    const test_lock = @import("../testing/postgres_lock.zig");
    test_lock.lock(io);
    defer test_lock.unlock(io);

    const PostgresTrackStore = @import("../index/postgres_track_store.zig").PostgresTrackStore;
    var postgres = try PostgresTrackStore.init(allocator, io, database_url, 2);
    defer postgres.deinit();
    var implementation: PostgresArtistMetricStore = .{ .pool = postgres.pool };
    const store = implementation.store();

    var database_row = (try postgres.pool.row("SELECT current_database()", .{})).?;
    const database_name = try allocator.dupe(u8, try database_row.get([]const u8, 0));
    defer allocator.free(database_name);
    try database_row.deinit();
    if (!std.mem.eql(u8, database_name, "zig_test")) return error.UnsafeTestDatabase;

    _ = try postgres.pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    _ = try postgres.pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE plyr_index.account_availability (
        \\  repo_did text PRIMARY KEY,
        \\  available boolean NOT NULL
        \\)
    , .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE plyr_index.track_records (
        \\  record_uri text PRIMARY KEY,
        \\  record_cid text NOT NULL,
        \\  owner_did text NOT NULL,
        \\  collection text NOT NULL,
        \\  title text NOT NULL,
        \\  duration_seconds bigint,
        \\  record_created_at timestamptz NOT NULL,
        \\  self_labels text[] NOT NULL DEFAULT '{}',
        \\  deleted boolean NOT NULL DEFAULT false
        \\)
    , .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE plyr_index.track_policies (
        \\  record_uri text PRIMARY KEY,
        \\  visibility text,
        \\  moderation_decision text,
        \\  operator_labels jsonb NOT NULL DEFAULT '[]'::jsonb
        \\)
    , .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE plyr_index.track_metrics (
        \\  record_uri text PRIMARY KEY,
        \\  play_count bigint NOT NULL
        \\)
    , .{});
    _ = try postgres.pool.exec(
        "INSERT INTO plyr_index.account_availability VALUES ($1, true)",
        .{"did:plc:artist"},
    );

    const cid = "bafyreihdcss27ihlhmjofustbdvksrwyxnjj3hhk7azqs2626paka66c2a";
    const public_uri = "at://did:plc:artist/fm.plyr.dev.track/public";
    const supporters_uri = "at://did:plc:artist/fm.plyr.dev.track/supporters";
    const allowed_uri = "at://did:plc:artist/fm.plyr.dev.track/allowed";
    const private_uri = "at://did:plc:artist/fm.plyr.dev.track/private";
    const blocked_uri = "at://did:plc:artist/fm.plyr.dev.track/blocked";
    const insert_record =
        \\INSERT INTO plyr_index.track_records (
        \\  record_uri, record_cid, owner_did, collection, title,
        \\  duration_seconds, record_created_at, self_labels
        \\) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::text[])
    ;
    _ = try postgres.pool.exec(insert_record, .{ public_uri, cid, "did:plc:artist", "fm.plyr.dev.track", "Public", @as(?i64, 100), "2026-08-09T00:00:00Z", &[_][]const u8{} });
    _ = try postgres.pool.exec(insert_record, .{ supporters_uri, cid, "did:plc:artist", "fm.plyr.dev.track", "Supporters", @as(?i64, 200), "2026-08-09T01:00:00Z", &[_][]const u8{} });
    _ = try postgres.pool.exec(insert_record, .{ allowed_uri, cid, "did:plc:artist", "fm.plyr.dev.track", "Allowed", @as(?i64, 50), "2026-08-09T02:00:00Z", &[_][]const u8{"copyright-violation"} });
    _ = try postgres.pool.exec(insert_record, .{ private_uri, cid, "did:plc:artist", "fm.plyr.dev.track", "Private", @as(?i64, 1000), "2026-08-09T03:00:00Z", &[_][]const u8{} });
    _ = try postgres.pool.exec(insert_record, .{ blocked_uri, cid, "did:plc:artist", "fm.plyr.dev.track", "Blocked", @as(?i64, 2000), "2026-08-09T04:00:00Z", &[_][]const u8{"copyright-violation"} });

    _ = try postgres.pool.exec("INSERT INTO plyr_index.track_policies VALUES ($1, 'supporters', NULL, '[]')", .{supporters_uri});
    _ = try postgres.pool.exec("INSERT INTO plyr_index.track_policies VALUES ($1, 'public', 'allow', '[]')", .{allowed_uri});
    _ = try postgres.pool.exec("INSERT INTO plyr_index.track_policies VALUES ($1, 'private', NULL, '[]')", .{private_uri});
    _ = try postgres.pool.exec("INSERT INTO plyr_index.track_metrics VALUES ($1, 7), ($2, 11), ($3, 3), ($4, 100), ($5, 200)", .{ public_uri, supporters_uri, allowed_uri, private_uri, blocked_uri });

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const value = try store.get(
        arena.allocator(),
        "did:plc:artist",
        "fm.plyr.dev.track",
    );
    try std.testing.expectEqual(@as(i64, 3), value.totals.tracks);
    try std.testing.expectEqual(@as(i64, 350), value.totals.duration_seconds);
    try std.testing.expectEqual(@as(i64, 21), value.totals.plays);
    try std.testing.expectEqualStrings(supporters_uri, value.top_track.?.record.uri);
    try std.testing.expectEqual(@as(i64, 11), value.top_track.?.play_count);

    const empty = try store.get(
        arena.allocator(),
        "did:plc:nobody",
        "fm.plyr.dev.track",
    );
    try std.testing.expectEqual(@as(i64, 0), empty.totals.tracks);
    try std.testing.expect(empty.top_track == null);
}
