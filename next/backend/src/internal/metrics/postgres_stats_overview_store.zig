//! The stats page's overview for one range: plays over time, the change
//! against the range before, uploads, likes, and the most played tracks and
//! artists. PostgreSQL builds the JSON; each range is cached for a minute.
//!
//! Plays over time come from two dated sources that never overlap: next's own
//! counted play receipts and legacy production's dated plays
//! (`legacy_play_days`). Legacy counted many early plays without a date, so
//! the all-time range ranks by each track's full count instead, and reports
//! how many of those plays carry a date.

const std = @import("std");
const pg = @import("pg");

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

    fn bucket(self: Range) []const u8 {
        return switch (self) {
            .week, .month => "day",
            .year, .all => "month",
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
        const slot = &self.cached[@intFromEnum(range)];
        const now = std.Io.Timestamp.now(self.io, .awake).nanoseconds;
        if (slot.*) |value| {
            if (now - value.refreshed_ns < 60 * std.time.ns_per_s) return allocator.dupe(u8, value.json);
        }
        var row = (self.pool.row(query, .{ self.collection, range.days(), range.bucket(), @tagName(range), self.like_collection }) catch |err| {
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
// $3 bucket ('day' or 'month'), $4 range name, $5 like collection.
// The all-time series starts at the first dated play. Listed tracks are the
// ones getStats counts: available, discoverable,
// not removed.
const query =
    \\WITH listed AS (
    \\  SELECT v.record_uri, v.owner_did, COALESCE(m.play_count, 0)::bigint AS plays,
    \\    (to_timestamp(v.record_created_at_us / 1000000.0) AT TIME ZONE 'UTC')::date AS created_day
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
    \\bounds AS (
    \\  SELECT (now() AT TIME ZONE 'UTC')::date AS end_day,
    \\    (now() AT TIME ZONE 'UTC')::date - ($2::int - 1) AS start_day,
    \\    (now() AT TIME ZONE 'UTC')::date - (2 * $2::int - 1) AS previous_day
    \\),
    \\dated AS (
    \\  SELECT r.record_uri, (r.accepted_at AT TIME ZONE 'UTC')::date AS day, count(*)::bigint AS plays
    \\  FROM plyr_index.play_receipts AS r
    \\  JOIN listed AS l ON l.record_uri = r.record_uri
    \\  WHERE r.counted AND ($2::int IS NULL OR r.accepted_at >= (SELECT previous_day FROM bounds))
    \\  GROUP BY 1, 2
    \\  UNION ALL
    \\  SELECT d.record_uri, d.day, d.plays
    \\  FROM plyr_index.legacy_play_days AS d
    \\  JOIN listed AS l ON l.record_uri = d.record_uri
    \\  WHERE $2::int IS NULL OR d.day >= (SELECT previous_day FROM bounds)
    \\),
    \\in_range AS (
    \\  SELECT d.* FROM dated AS d WHERE $2::int IS NULL OR d.day >= (SELECT start_day FROM bounds)
    \\),
    \\first_day AS (
    \\  SELECT COALESCE((SELECT start_day FROM bounds), (SELECT min(day) FROM dated),
    \\    (SELECT min(created_day) FROM listed), (SELECT end_day FROM bounds)) AS day
    \\),
    \\buckets AS (
    \\  SELECT g::date AS start
    \\  FROM generate_series(date_trunc($3, (SELECT day FROM first_day)), date_trunc($3, (SELECT end_day FROM bounds)), ('1 ' || $3)::interval) AS g
    \\),
    \\series AS (
    \\  SELECT b.start,
    \\    COALESCE((SELECT sum(i.plays) FROM in_range AS i WHERE date_trunc($3, i.day)::date = b.start), 0)::bigint AS plays,
    \\    (SELECT count(*) FROM listed AS l WHERE date_trunc($3, l.created_day)::date = b.start
    \\      AND l.created_day >= (SELECT day FROM first_day))::bigint AS uploads
    \\  FROM buckets AS b
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
    \\  'bucket', $3::text,
    \\  'start_day', (SELECT day FROM first_day),
    \\  'end_day', (SELECT end_day FROM bounds),
    \\  'plays', CASE WHEN $2::int IS NULL THEN (SELECT COALESCE(sum(plays), 0) FROM listed)
    \\    ELSE (SELECT COALESCE(sum(plays), 0) FROM in_range) END::bigint,
    \\  'dated_plays', (SELECT COALESCE(sum(plays), 0) FROM in_range)::bigint,
    \\  'previous_plays', CASE WHEN $2::int IS NULL THEN NULL
    \\    ELSE (SELECT COALESCE(sum(plays), 0) FROM dated WHERE day < (SELECT start_day FROM bounds))::bigint END,
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
    _ = try pool.exec("CREATE TABLE plyr_index.legacy_play_days (record_uri text, day date, plays bigint, PRIMARY KEY (record_uri, day))", .{});
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
        \\INSERT INTO plyr_index.legacy_play_days VALUES
        \\('old', (now() AT TIME ZONE 'UTC')::date - 2, 2),('old', (now() AT TIME ZONE 'UTC')::date - 9, 4),
        \\('old', (now() AT TIME ZONE 'UTC')::date - 400, 5),('hidden', (now() AT TIME ZONE 'UTC')::date, 7)
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
        bucket: []const u8,
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
    try std.testing.expectEqualStrings("day", week.value.bucket);
    try std.testing.expectEqual(@as(usize, 7), week.value.series.len);
    try std.testing.expectEqual(@as(i64, 2), week.value.series[6].plays);
    try std.testing.expectEqual(@as(i64, 1), week.value.series[5].plays);
    try std.testing.expectEqual(@as(i64, 2), week.value.series[4].plays);
    try std.testing.expectEqual(@as(i64, 1), week.value.series[6].uploads);
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
    try std.testing.expectEqualStrings("month", all.value.bucket);
    try std.testing.expectEqualStrings("old", all.value.tracks[0].uri);
    try std.testing.expectEqual(@as(i64, 50), all.value.tracks[0].plays);
    try std.testing.expectEqualStrings("a", all.value.artists[0].did);
    try std.testing.expectEqual(@as(i64, 1), all.value.artists[0].tracks);

    // a minute's cache: new plays show after the snapshot expires
    _ = try pool.exec("INSERT INTO plyr_index.play_receipts (record_uri, accepted_at, counted) VALUES ('new', now(), true)", .{});
    const cached_json = try store.get(allocator, .week);
    defer allocator.free(cached_json);
    try std.testing.expectEqualStrings(week_json, cached_json);
    store.cached[@intFromEnum(Range.week)].?.refreshed_ns -= 61 * std.time.ns_per_s;
    const fresh_json = try store.get(allocator, .week);
    defer allocator.free(fresh_json);
    const fresh = try std.json.parseFromSlice(Overview, allocator, fresh_json, .{ .ignore_unknown_fields = true });
    defer fresh.deinit();
    try std.testing.expectEqual(@as(i64, 6), fresh.value.plays);
}
