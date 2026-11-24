//! The stats page's overview for one range: plays over time, the change
//! against the range before, uploads, likes, and the most played tracks and
//! artists. PostgreSQL builds the JSON; each range is cached for a minute.
//!
//! Plays over time come from two dated sources that never overlap: next's own
//! counted play receipts and legacy production's dated plays
//! (`legacy_play_hours`). Each range is drawn in bars of a few hours or a
//! day, so a short range still has enough bars to show its shape. Legacy counted many early plays without a date, so
//! the all-time range ranks by each track's full count instead, and reports
//! how many of those plays carry a date.

const std = @import("std");
const pg = @import("pg");
const query_pairs = @import("../http/query.zig");

pub const Range = enum {
    week,
    month,
    year,
    all,

    fn days(self: Range) ?i32 {
        return switch (self) {
            .week => 7,
            .month => 30,
            .year => 365,
            .all => null,
        };
    }

    /// The `range` query parameter: one of the four names, month when absent.
    pub fn parse(allocator: std.mem.Allocator, target: []const u8) !Range {
        var pairs = query_pairs.Iterator.init(allocator, target);
        var range: ?Range = null;
        while (try pairs.next()) |pair| {
            if (!std.mem.eql(u8, pair.name, "range") or range != null) return error.InvalidQuery;
            range = std.meta.stringToEnum(Range, pair.value) orelse return error.InvalidQuery;
        }
        return range orelse .month;
    }

    /// how many hours each bar of the series covers
    fn bucketHours(self: Range) i32 {
        return switch (self) {
            .week => 3,
            .month => 6,
            .year, .all => 24,
        };
    }
};

pub const Error = error{ MetricsUnavailable, CorruptMetrics, OutOfMemory };

const Cached = struct { json: []u8, refreshed_ns: i96 };

pub const PostgresStatsOverviewStore = struct {
    pool: *pg.Pool,
    io: std.Io,
    collection: []const u8,
    like_collection: []const u8,
    /// owns the cached JSON; a refresh frees the snapshot it replaces
    cache_allocator: std.mem.Allocator = std.heap.smp_allocator,
    mutex: std.Io.Mutex = .init,
    cached: [4]?Cached = .{ null, null, null, null },

    /// The overview as JSON, copied into `allocator`.
    pub fn get(self: *PostgresStatsOverviewStore, allocator: std.mem.Allocator, range: Range) Error![]const u8 {
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        const slot = &self.cached[@backingInt(range)];
        const now = std.Io.Timestamp.now(self.io, .awake).nanoseconds;
        if (slot.*) |value| {
            if (now - value.refreshed_ns < 60 * std.time.ns_per_s) return allocator.dupe(u8, value.json);
        }
        var row = (self.pool.row(query, .{ self.collection, range.days(), range.bucketHours(), @tagName(range), self.like_collection }) catch |err| {
            std.log.err("stats overview query failed: {}", .{err});
            return error.MetricsUnavailable;
        }) orelse return error.CorruptMetrics;
        var active = true;
        defer if (active) {
            row.deinit() catch row.result.deinit();
        };
        const text = row.get([]const u8, 0) catch return error.CorruptMetrics;
        const owned = try self.cache_allocator.dupe(u8, text);
        errdefer self.cache_allocator.free(owned);
        const copy = try allocator.dupe(u8, owned);
        row.deinit() catch {
            active = false;
            row.result.deinit();
            self.cache_allocator.free(owned);
            return error.MetricsUnavailable;
        };
        active = false;
        if (slot.*) |old| self.cache_allocator.free(old.json);
        slot.* = .{ .json = owned, .refreshed_ns = now };
        return copy;
    }

    pub fn deinit(self: *PostgresStatsOverviewStore) void {
        for (&self.cached) |*slot| {
            if (slot.*) |value| self.cache_allocator.free(value.json);
            slot.* = null;
        }
    }
};

// $1 track collection, $2 range length in days (NULL = all time),
// $3 hours per bar, $4 range name, $5 like collection.
// Bars are aligned to UTC (midnight for daily bars) and the last one holds
// the current hour. The all-time series starts at the first dated play.
// Listed tracks are the ones getStats counts: available, discoverable,
// not removed.
const query =
    \\WITH listed AS (
    \\  SELECT v.record_uri, v.owner_did, COALESCE(m.play_count, 0)::bigint AS plays,
    \\    to_timestamp(v.record_created_at_us / 1000000.0) AS created_at
    \\  FROM plyr_index.track_records AS v
    \\  JOIN plyr_index.account_availability AS aa ON aa.repo_did = v.owner_did AND aa.available
    \\  LEFT JOIN plyr_index.track_policies AS pol ON pol.record_uri = v.record_uri
    \\  LEFT JOIN plyr_index.track_metrics AS m ON m.record_uri = v.record_uri
    \\  WHERE v.collection = $1 AND NOT v.deleted
    \\    AND v.support_gate_type IS DISTINCT FROM 'owner'
    \\    AND COALESCE(pol.visibility, 'public') IN ('public', 'supporters')
    \\    AND pol.moderation_decision IS DISTINCT FROM 'exclude'
    \\    AND (pol.moderation_decision IS NOT DISTINCT FROM 'allow' OR NOT (
    \\      v.self_labels && ARRAY['copyright-violation']::text[]
    \\      OR COALESCE(pol.operator_labels, '[]'::jsonb) ?| ARRAY['copyright-violation']))
    \\),
    \\bar AS (
    \\  SELECT make_interval(hours => $3::int) AS width, timestamptz '2000-01-01 00:00+00' AS origin
    \\),
    \\bounds AS (
    \\  SELECT e.end_at, e.end_at - make_interval(days => $2::int) AS start_at,
    \\    e.end_at - make_interval(days => 2 * $2::int) AS previous_at
    \\  FROM (SELECT date_bin(width, now(), origin) + width AS end_at FROM bar) AS e
    \\),
    \\dated AS (
    \\  SELECT r.record_uri, date_trunc('hour', r.accepted_at, 'UTC') AS at, count(*)::bigint AS plays
    \\  FROM plyr_index.play_receipts AS r
    \\  JOIN listed AS l ON l.record_uri = r.record_uri
    \\  WHERE r.counted AND ($2::int IS NULL OR r.accepted_at >= (SELECT previous_at FROM bounds))
    \\  GROUP BY 1, 2
    \\  UNION ALL
    \\  SELECT h.record_uri, h.hour, h.plays
    \\  FROM plyr_index.legacy_play_hours AS h
    \\  JOIN listed AS l ON l.record_uri = h.record_uri
    \\  WHERE $2::int IS NULL OR h.hour >= (SELECT previous_at FROM bounds)
    \\),
    \\in_range AS (
    \\  SELECT d.* FROM dated AS d WHERE $2::int IS NULL OR d.at >= (SELECT start_at FROM bounds)
    \\),
    \\first_at AS (
    \\  SELECT COALESCE((SELECT start_at FROM bounds),
    \\    date_bin(width, (SELECT min(at) FROM dated), origin),
    \\    date_bin(width, (SELECT min(created_at) FROM listed), origin),
    \\    (SELECT end_at FROM bounds) - width) AS at
    \\  FROM bar
    \\),
    \\binned AS (
    \\  SELECT date_bin(width, i.at, origin) AS start, sum(i.plays)::bigint AS plays
    \\  FROM in_range AS i, bar GROUP BY 1
    \\),
    \\arrivals AS (
    \\  SELECT date_bin(width, l.created_at, origin) AS start, count(*)::bigint AS uploads
    \\  FROM listed AS l, bar
    \\  WHERE l.created_at >= (SELECT at FROM first_at) AND l.created_at < (SELECT end_at FROM bounds)
    \\  GROUP BY 1
    \\),
    \\series AS (
    \\  SELECT g.start, COALESCE(p.plays, 0)::bigint AS plays, COALESCE(u.uploads, 0)::bigint AS uploads
    \\  FROM (SELECT generate_series((SELECT at FROM first_at), (SELECT end_at FROM bounds) - width, width) AS start FROM bar) AS g
    \\  LEFT JOIN binned AS p ON p.start = g.start
    \\  LEFT JOIN arrivals AS u ON u.start = g.start
    \\),
    \\track_plays AS (
    \\  SELECT record_uri, owner_did, plays FROM listed WHERE $2::int IS NULL
    \\  UNION ALL
    \\  SELECT i.record_uri, l.owner_did, sum(i.plays)::bigint
    \\  FROM in_range AS i JOIN listed AS l ON l.record_uri = i.record_uri
    \\  WHERE $2::int IS NOT NULL
    \\  GROUP BY 1, 2
    \\),
    \\artist_plays AS (
    \\  SELECT t.owner_did, sum(t.plays)::bigint AS plays,
    \\    (SELECT count(*) FROM listed AS l WHERE l.owner_did = t.owner_did)::bigint AS tracks
    \\  FROM track_plays AS t WHERE t.plays > 0
    \\  GROUP BY 1
    \\)
    \\SELECT json_build_object(
    \\  'object', 'stats_overview',
    \\  'range', $4::text,
    \\  'bucket_hours', $3::int,
    \\  'start', (SELECT at FROM first_at),
    \\  'end', (SELECT end_at FROM bounds),
    \\  'plays', CASE WHEN $2::int IS NULL THEN (SELECT COALESCE(sum(plays), 0) FROM listed)
    \\    ELSE (SELECT COALESCE(sum(plays), 0) FROM in_range) END::bigint,
    \\  'dated_plays', (SELECT COALESCE(sum(plays), 0) FROM in_range)::bigint,
    \\  'previous_plays', CASE WHEN $2::int IS NULL THEN NULL
    \\    ELSE (SELECT COALESCE(sum(plays), 0) FROM dated WHERE at < (SELECT start_at FROM bounds))::bigint END,
    \\  'uploads', CASE WHEN $2::int IS NULL THEN (SELECT count(*) FROM listed)
    \\    ELSE (SELECT COALESCE(sum(uploads), 0) FROM series) END::bigint,
    \\  'likes', (SELECT count(*) FROM plyr_index.like_records AS k JOIN listed AS l ON l.record_uri = k.subject_uri
    \\    WHERE k.collection = $5 AND NOT k.deleted)::bigint,
    \\  'series', (SELECT COALESCE(json_agg(json_build_object('start', start, 'plays', plays, 'uploads', uploads) ORDER BY start), '[]') FROM series),
    \\  'tracks', (SELECT COALESCE(json_agg(json_build_object('uri', record_uri, 'plays', plays) ORDER BY plays DESC, record_uri), '[]')
    \\    FROM (SELECT record_uri, plays FROM track_plays WHERE plays > 0 ORDER BY plays DESC, record_uri LIMIT 10) AS top),
    \\  'artists', (SELECT COALESCE(json_agg(json_build_object('did', owner_did, 'plays', plays, 'tracks', tracks) ORDER BY plays DESC, owner_did), '[]')
    \\    FROM (SELECT * FROM artist_plays ORDER BY plays DESC, owner_did LIMIT 500) AS top)
    \\)::text
;

test "overview range is one of four names, month by default" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    try std.testing.expectEqual(Range.month, try Range.parse(a, "/xrpc"));
    try std.testing.expectEqual(Range.week, try Range.parse(a, "/xrpc?range=week"));
    try std.testing.expectEqual(Range.all, try Range.parse(a, "/xrpc?range=all"));
    try std.testing.expectError(error.InvalidQuery, Range.parse(a, "/xrpc?range=day"));
    try std.testing.expectError(error.InvalidQuery, Range.parse(a, "/xrpc?range=week&range=all"));
    try std.testing.expectError(error.InvalidQuery, Range.parse(a, "/xrpc?period=week"));
}

test "stats overview counts dated plays by range and ranks tracks and artists" {
    const url = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    const lock = @import("../testing/postgres_lock.zig");
    lock.lock(io);
    defer lock.unlock(io);
    var database = try @import("../index/postgres_track_store.zig").PostgresTrackStore.init(allocator, io, std.mem.span(url), 2);
    defer database.deinit();
    const pool = database.pool;
    var name = (try pool.row("SELECT current_database()", .{})).?;
    const safe = std.mem.eql(u8, try name.get([]const u8, 0), "zig_test");
    try name.deinit();
    if (!safe) return error.UnsafeTestDatabase;
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.account_availability (repo_did text PRIMARY KEY, available boolean)", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.track_records (record_uri text PRIMARY KEY, owner_did text, collection text, support_gate_type text, deleted boolean DEFAULT false, self_labels text[] DEFAULT '{}', record_created_at_us bigint)", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.track_policies (record_uri text PRIMARY KEY, visibility text, moderation_decision text, operator_labels jsonb DEFAULT '[]')", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.track_metrics (record_uri text PRIMARY KEY, play_count bigint)", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.play_receipts (occurrence uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_uri text, accepted_at timestamptz, counted boolean)", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.legacy_play_hours (record_uri text, hour timestamptz, plays bigint, PRIMARY KEY (record_uri, hour))", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.like_records (record_uri text PRIMARY KEY, collection text, subject_uri text, deleted boolean)", .{});
    _ = try pool.exec("INSERT INTO plyr_index.account_availability VALUES ('a',true),('b',true),('c',false)", .{});
    // 'new' was created today, 'old' long ago; 'hidden' is private and 'gone' is offline
    _ = try pool.exec(
        \\INSERT INTO plyr_index.track_records (record_uri, owner_did, collection, record_created_at_us) VALUES
        \\('old','a','fm.plyr.track',0),('new','b','fm.plyr.track',(extract(epoch FROM now()) * 1000000)::bigint),
        \\('hidden','a','fm.plyr.track',0),('gone','c','fm.plyr.track',0)
    , .{});
    _ = try pool.exec("INSERT INTO plyr_index.track_policies VALUES ('hidden','private',null,'[]')", .{});
    _ = try pool.exec("INSERT INTO plyr_index.track_metrics VALUES ('old',50),('new',3),('hidden',9),('gone',9)", .{});
    // this week: 3 plays of 'new' on next, 2 legacy plays of 'old'; the week before: 4 legacy plays of 'old'
    _ = try pool.exec(
        \\INSERT INTO plyr_index.play_receipts (record_uri, accepted_at, counted) VALUES
        \\('new', now(), true),('new', now(), true),('new', now() - interval '1 day', true),('new', now(), false),
        \\('hidden', now(), true),('gone', now(), true)
    , .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.legacy_play_hours VALUES
        \\('old', date_trunc('hour', now() - interval '2 days'), 2),('old', date_trunc('hour', now() - interval '9 days'), 4),
        \\('old', date_trunc('hour', now() - interval '400 days'), 5),('hidden', date_trunc('hour', now()), 7)
    , .{});
    _ = try pool.exec("INSERT INTO plyr_index.like_records VALUES ('l1','fm.plyr.like','old',false),('l2','fm.plyr.like','old',true),('l3','fm.plyr.like','hidden',false),('l4','fm.other.like','new',false)", .{});

    var store: PostgresStatsOverviewStore = .{ .pool = pool, .io = io, .collection = "fm.plyr.track", .like_collection = "fm.plyr.like", .cache_allocator = allocator };
    defer store.deinit();
    const Overview = struct {
        plays: i64,
        dated_plays: i64,
        previous_plays: ?i64,
        uploads: i64,
        likes: i64,
        bucket_hours: i64,
        series: []const struct { start: []const u8, plays: i64, uploads: i64 },
        tracks: []const struct { uri: []const u8, plays: i64 },
        artists: []const struct { did: []const u8, plays: i64, tracks: i64 },
    };

    const week_json = try store.get(allocator, .week);
    defer allocator.free(week_json);
    const week = try std.json.parseFromSlice(Overview, allocator, week_json, .{ .ignore_unknown_fields = true });
    defer week.deinit();
    try std.testing.expectEqual(@as(i64, 5), week.value.plays);
    try std.testing.expectEqual(@as(?i64, 4), week.value.previous_plays);
    try std.testing.expectEqual(@as(i64, 1), week.value.uploads);
    try std.testing.expectEqual(@as(i64, 1), week.value.likes);
    // 56 bars of 3 hours; the last holds the current hour
    try std.testing.expectEqual(@as(i64, 3), week.value.bucket_hours);
    try std.testing.expectEqual(@as(usize, 56), week.value.series.len);
    try std.testing.expectEqual(@as(i64, 2), week.value.series[55].plays);
    try std.testing.expectEqual(@as(i64, 1), week.value.series[47].plays);
    try std.testing.expectEqual(@as(i64, 2), week.value.series[39].plays);
    try std.testing.expectEqual(@as(i64, 1), week.value.series[55].uploads);
    try std.testing.expectEqual(@as(usize, 2), week.value.tracks.len);
    try std.testing.expectEqualStrings("new", week.value.tracks[0].uri);
    try std.testing.expectEqual(@as(i64, 3), week.value.tracks[0].plays);
    try std.testing.expectEqualStrings("b", week.value.artists[0].did);

    const all_json = try store.get(allocator, .all);
    defer allocator.free(all_json);
    const all = try std.json.parseFromSlice(Overview, allocator, all_json, .{ .ignore_unknown_fields = true });
    defer all.deinit();
    // all time ranks by full counts, undated plays included
    try std.testing.expectEqual(@as(i64, 53), all.value.plays);
    try std.testing.expectEqual(@as(i64, 14), all.value.dated_plays);
    try std.testing.expectEqual(@as(?i64, null), all.value.previous_plays);
    try std.testing.expectEqual(@as(i64, 24), all.value.bucket_hours);
    try std.testing.expectEqualStrings("old", all.value.tracks[0].uri);
    try std.testing.expectEqual(@as(i64, 50), all.value.tracks[0].plays);
    try std.testing.expectEqualStrings("a", all.value.artists[0].did);
    try std.testing.expectEqual(@as(i64, 1), all.value.artists[0].tracks);

    // a minute's cache: new plays show after the snapshot expires
    _ = try pool.exec("INSERT INTO plyr_index.play_receipts (record_uri, accepted_at, counted) VALUES ('new', now(), true)", .{});
    const cached_json = try store.get(allocator, .week);
    defer allocator.free(cached_json);
    try std.testing.expectEqualStrings(week_json, cached_json);
    store.cached[@backingInt(Range.week)].?.refreshed_ns -= 61 * std.time.ns_per_s;
    const fresh_json = try store.get(allocator, .week);
    defer allocator.free(fresh_json);
    const fresh = try std.json.parseFromSlice(Overview, allocator, fresh_json, .{ .ignore_unknown_fields = true });
    defer fresh.deinit();
    try std.testing.expectEqual(@as(i64, 6), fresh.value.plays);
}
