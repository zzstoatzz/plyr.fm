//! PostgreSQL adapter for application-owned play aggregates.
//!
//! The durable key is the authenticated record URI. The `public.tracks`
//! update is an explicitly transitional mirror for the Python backend; no
//! legacy identifier enters the application contract.

const std = @import("std");
const pg = @import("pg");
const PlayMetricStore = @import("play_metric_store.zig").PlayMetricStore;

pub const PostgresPlayMetricStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresPlayMetricStore) PlayMetricStore {
        return .{
            .context = self,
            .inspect_fn = inspectOpaque,
            .increment_fn = incrementOpaque,
        };
    }

    fn inspectOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        record_uri: []const u8,
    ) PlayMetricStore.Error!?PlayMetricStore.Candidate {
        const self: *PostgresPlayMetricStore = @ptrCast(@alignCast(context));
        return self.inspect(allocator, record_uri);
    }

    fn incrementOpaque(
        context: *anyopaque,
        record_uri: []const u8,
        attribution: ?PlayMetricStore.Attribution,
    ) PlayMetricStore.Error!?i64 {
        const self: *PostgresPlayMetricStore = @ptrCast(@alignCast(context));
        return self.increment(record_uri, attribution);
    }

    fn inspect(
        self: *PostgresPlayMetricStore,
        _: std.mem.Allocator,
        record_uri: []const u8,
    ) PlayMetricStore.Error!?PlayMetricStore.Candidate {
        var query_row = self.pool.row(inspect_query, .{record_uri}) catch |err| {
            logQueryError(null, "play metric lookup failed", err);
            return error.MetricsUnavailable;
        } orelse return null;
        var active = true;
        defer if (active) forceReleaseQueryRow(&query_row);

        const duration = query_row.get(?i64, 0) catch return error.CorruptMetrics;
        const count = query_row.get(i64, 1) catch return error.CorruptMetrics;
        if ((duration != null and duration.? < 0) or count < 0)
            return error.CorruptMetrics;
        finishQueryRow(&query_row) catch return error.MetricsUnavailable;
        active = false;
        return .{ .duration_seconds = duration, .play_count = count };
    }

    fn increment(
        self: *PostgresPlayMetricStore,
        record_uri: []const u8,
        attribution: ?PlayMetricStore.Attribution,
    ) PlayMetricStore.Error!?i64 {
        const conn = self.pool.acquire() catch |err| {
            std.log.err("play metric connection failed: {}", .{err});
            return error.MetricsUnavailable;
        };
        defer self.pool.release(conn);
        const ref_code: ?[]const u8 = if (attribution) |value| value.ref_code else null;
        const listener_did: ?[]const u8 = if (attribution) |value| value.listener_did else null;
        var query_row = conn.row(increment_query, .{ record_uri, ref_code, listener_did }) catch |err| {
            logQueryError(conn, "play metric increment failed", err);
            return error.MetricsUnavailable;
        } orelse return null;
        var active = true;
        defer if (active) forceReleaseQueryRow(&query_row);

        const count = query_row.get(i64, 0) catch return error.CorruptMetrics;
        if (count < 0) return error.CorruptMetrics;
        finishQueryRow(&query_row) catch return error.MetricsUnavailable;
        active = false;
        return count;
    }
};

fn logQueryError(conn: ?*pg.Conn, message: []const u8, err: anyerror) void {
    if (conn) |connection| {
        if (connection.err) |pg_err| {
            std.log.err("{s}: {}: {s}", .{ message, err, pg_err.message });
            return;
        }
    }
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
        std.log.err("forced play metric result cleanup: {}", .{err});
}

const admitted_cte =
    \\SELECT v.record_uri, v.duration_seconds
    \\FROM plyr_index.track_records AS v
    \\JOIN plyr_index.account_availability AS aa
    \\  ON aa.repo_did = v.owner_did AND aa.available
    \\LEFT JOIN plyr_index.track_policies AS pol ON pol.record_uri = v.record_uri
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
;

const inspect_query = "WITH admitted AS (\n" ++ admitted_cte ++
    ")\n" ++
    \\SELECT a.duration_seconds, COALESCE(m.play_count, 0)::bigint
    \\FROM admitted AS a
    \\LEFT JOIN plyr_index.track_metrics AS m ON m.record_uri = a.record_uri
;

const increment_query = "WITH admitted AS (\n" ++ admitted_cte ++
    "), metric AS (\n" ++
    \\  INSERT INTO plyr_index.track_metrics (
    \\    record_uri, play_count, write_source, observed_at_us
    \\  )
    \\  SELECT
    \\    a.record_uri,
    \\    COALESCE(existing.play_count, 0) + 1,
    \\    'http_play',
    \\    (extract(epoch FROM clock_timestamp()) * 1000000)::bigint
    \\  FROM admitted AS a
    \\  LEFT JOIN plyr_index.track_metrics AS existing
    \\    ON existing.record_uri = a.record_uri
    \\  ON CONFLICT (record_uri) DO UPDATE SET
    \\    play_count = track_metrics.play_count + 1,
    \\    write_source = EXCLUDED.write_source,
    \\    observed_at_us = EXCLUDED.observed_at_us
    \\  RETURNING record_uri, play_count
    \\), legacy_mirror AS (
    \\  UPDATE public.tracks AS legacy
    \\  SET play_count = metric.play_count::integer
    \\  FROM metric
    \\  WHERE legacy.atproto_record_uri = metric.record_uri
    \\    AND metric.play_count <= 2147483647
    \\  RETURNING legacy.atproto_record_uri
    \\), share_attribution AS (
    \\  INSERT INTO public.share_link_events (share_link_id, visitor_did, event_type)
    \\  SELECT share.id, $3::text, 'play'
    \\  FROM metric
    \\  JOIN public.tracks AS legacy ON legacy.atproto_record_uri = metric.record_uri
    \\  JOIN public.share_links AS share
    \\    ON share.track_id = legacy.id AND share.code = $2::text
    \\  WHERE $2::text IS NOT NULL
    \\    AND ($3::text IS NULL OR $3::text <> share.creator_did)
    \\)
    \\SELECT play_count FROM metric
;

test "PostgreSQL metric writes are canonical, atomic, and policy gated" {
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
    var implementation: PostgresPlayMetricStore = .{ .pool = postgres.pool };
    const store = implementation.store();

    var database_row = (try postgres.pool.row("SELECT current_database()", .{})).?;
    const database_name = try allocator.dupe(u8, try database_row.get([]const u8, 0));
    defer allocator.free(database_name);
    try database_row.deinit();
    if (!std.mem.eql(u8, database_name, "zig_test")) return error.UnsafeTestDatabase;

    _ = try postgres.pool.exec("DROP TABLE IF EXISTS share_link_events", .{});
    _ = try postgres.pool.exec("DROP TABLE IF EXISTS share_links", .{});
    _ = try postgres.pool.exec("DROP TABLE IF EXISTS tracks CASCADE", .{});
    _ = try postgres.pool.exec("CREATE SCHEMA IF NOT EXISTS plyr_index", .{});
    _ = try postgres.pool.exec("DROP TABLE IF EXISTS plyr_index.track_metrics", .{});
    _ = try postgres.pool.exec("DROP TABLE IF EXISTS plyr_index.track_policies", .{});
    _ = try postgres.pool.exec("DROP TABLE IF EXISTS plyr_index.account_availability", .{});
    _ = try postgres.pool.exec("DROP TABLE IF EXISTS plyr_index.track_records", .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE tracks (
        \\  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        \\  atproto_record_uri text UNIQUE NOT NULL,
        \\  play_count integer NOT NULL
        \\)
    , .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE share_links (
        \\  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        \\  code text UNIQUE NOT NULL,
        \\  track_id integer NOT NULL REFERENCES tracks(id),
        \\  creator_did text NOT NULL
        \\)
    , .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE share_link_events (
        \\  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        \\  share_link_id integer NOT NULL REFERENCES share_links(id),
        \\  visitor_did text,
        \\  event_type text NOT NULL
        \\)
    , .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE plyr_index.track_records (
        \\  record_uri text PRIMARY KEY,
        \\  owner_did text NOT NULL,
        \\  duration_seconds bigint,
        \\  self_labels text[] NOT NULL DEFAULT '{}',
        \\  deleted boolean NOT NULL DEFAULT false
        \\)
    , .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE plyr_index.account_availability (
        \\  repo_did text PRIMARY KEY,
        \\  available boolean NOT NULL
        \\)
    , .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE plyr_index.track_policies (
        \\  record_uri text PRIMARY KEY,
        \\  visibility text NOT NULL,
        \\  operator_labels jsonb NOT NULL DEFAULT '[]',
        \\  moderation_decision text
        \\)
    , .{});
    _ = try postgres.pool.exec(
        \\CREATE TABLE plyr_index.track_metrics (
        \\  record_uri text PRIMARY KEY,
        \\  play_count bigint NOT NULL CHECK (play_count >= 0),
        \\  write_source text NOT NULL,
        \\  observed_at_us bigint NOT NULL
        \\)
    , .{});
    const public_uri = "at://did:plc:artist/fm.plyr.dev.track/public";
    const private_uri = "at://did:plc:artist/fm.plyr.dev.track/private";
    _ = try postgres.pool.exec(
        "INSERT INTO tracks (atproto_record_uri, play_count) VALUES ($1, 7), ($2, 11)",
        .{ public_uri, private_uri },
    );
    _ = try postgres.pool.exec(
        \\INSERT INTO plyr_index.track_records
        \\  (record_uri, owner_did, duration_seconds)
        \\VALUES ($1, 'did:plc:artist', 180), ($2, 'did:plc:artist', 90)
    , .{ public_uri, private_uri });
    _ = try postgres.pool.exec(
        "INSERT INTO plyr_index.account_availability VALUES ('did:plc:artist', true)",
        .{},
    );
    _ = try postgres.pool.exec(
        \\INSERT INTO plyr_index.track_policies (record_uri, visibility)
        \\VALUES ($1, 'public'), ($2, 'private')
    , .{ public_uri, private_uri });
    _ = try postgres.pool.exec(
        "INSERT INTO plyr_index.track_metrics VALUES ($1, 7, 'legacy_import', 1)",
        .{public_uri},
    );
    _ = try postgres.pool.exec(
        \\INSERT INTO share_links (code, track_id, creator_did)
        \\SELECT 'share123', id, 'did:plc:creator' FROM tracks
        \\WHERE atproto_record_uri = $1
    , .{public_uri});

    const before = (try store.inspect(allocator, public_uri)).?;
    try std.testing.expectEqual(@as(?i64, 180), before.duration_seconds);
    try std.testing.expectEqual(@as(i64, 7), before.play_count);
    try std.testing.expectEqual(@as(?i64, 8), try store.increment(public_uri, null));
    try std.testing.expectEqual(@as(?i64, 9), try store.increment(public_uri, .{
        .ref_code = "share123",
        .listener_did = "did:plc:listener",
    }));
    try std.testing.expect((try store.inspect(allocator, private_uri)) == null);
    try std.testing.expect((try store.increment(private_uri, null)) == null);

    var counts = (try postgres.pool.row(
        \\SELECT m.play_count, t.play_count
        \\FROM plyr_index.track_metrics AS m
        \\JOIN tracks AS t ON t.atproto_record_uri = m.record_uri
        \\WHERE m.record_uri = $1
    , .{public_uri})).?;
    try std.testing.expectEqual(@as(i64, 9), try counts.get(i64, 0));
    try std.testing.expectEqual(@as(i32, 9), try counts.get(i32, 1));
    try counts.deinit();
    var events = (try postgres.pool.row(
        "SELECT count(*)::bigint FROM share_link_events WHERE event_type = 'play'",
        .{},
    )).?;
    try std.testing.expectEqual(@as(i64, 1), try events.get(i64, 0));
    try events.deinit();
}
