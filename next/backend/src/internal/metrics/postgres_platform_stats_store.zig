const std = @import("std");
const pg = @import("pg");
const platform = @import("platform_stats_store.zig");

pub const PostgresPlatformStatsStore = struct {
    pool: *pg.Pool,
    io: std.Io,
    collection: []const u8,
    mutex: std.Io.Mutex = .init,
    cached: ?platform.Stats = null,
    refreshed_ns: i96 = 0,

    pub fn store(self: *PostgresPlatformStatsStore) platform.Store {
        return .{ .context = self, .get_fn = getOpaque };
    }

    fn getOpaque(context: *anyopaque) platform.Store.Error!platform.Stats {
        const self: *PostgresPlatformStatsStore = @ptrCast(@alignCast(context));
        self.mutex.lockUncancelable(self.io);
        defer self.mutex.unlock(self.io);
        const now = std.Io.Timestamp.now(self.io, .awake).nanoseconds;
        if (self.cached) |value| {
            if (now - self.refreshed_ns < 60 * std.time.ns_per_s) return value;
        }
        var row = (self.pool.row(query, .{self.collection}) catch return error.MetricsUnavailable) orelse return error.CorruptMetrics;
        var active = true;
        defer if (active) {
            row.deinit() catch row.result.deinit();
        };
        var values: [4]u64 = undefined;
        for (&values, 0..) |*value, index| {
            const raw = row.get(i64, index) catch return error.CorruptMetrics;
            value.* = std.math.cast(u64, raw) orelse return error.CorruptMetrics;
        }
        const value: platform.Stats = .{
            .tracks = values[0],
            .artists = values[1],
            .duration_seconds = values[2],
            .plays = values[3],
            .updated_at_ms = @intCast(@divFloor(std.Io.Timestamp.now(self.io, .real).nanoseconds, std.time.ns_per_ms)),
        };
        row.deinit() catch {
            active = false;
            row.result.deinit();
            return error.MetricsUnavailable;
        };
        active = false;
        self.cached = value;
        self.refreshed_ns = now;
        return value;
    }
};

const query =
    \\SELECT count(*)::bigint, count(DISTINCT v.owner_did)::bigint,
    \\  COALESCE(sum(v.duration_seconds), 0)::bigint,
    \\  COALESCE(sum(metrics.play_count), 0)::bigint
    \\FROM plyr_index.track_records AS v
    \\JOIN plyr_index.account_availability AS aa ON aa.repo_did = v.owner_did AND aa.available
    \\LEFT JOIN plyr_index.track_policies AS pol ON pol.record_uri = v.record_uri
    \\LEFT JOIN plyr_index.track_metrics AS metrics ON metrics.record_uri = v.record_uri
    \\WHERE v.collection = $1 AND NOT v.deleted
    \\  AND COALESCE(pol.visibility, 'public') IN ('public', 'supporters')
    \\  AND pol.moderation_decision IS DISTINCT FROM 'exclude'
    \\  AND (pol.moderation_decision IS NOT DISTINCT FROM 'allow' OR NOT (
    \\    v.self_labels && ARRAY['copyright-violation']::text[]
    \\    OR COALESCE(pol.operator_labels, '[]'::jsonb) ?| ARRAY['copyright-violation']))
;

test "platform stats exclude unavailable and non-discoverable records and cache one snapshot" {
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
    _ = try pool.exec("CREATE TABLE plyr_index.track_records (record_uri text PRIMARY KEY, owner_did text, collection text, duration_seconds bigint, deleted boolean DEFAULT false, self_labels text[] DEFAULT '{}')", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.track_policies (record_uri text PRIMARY KEY, visibility text, moderation_decision text, operator_labels jsonb DEFAULT '[]')", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.track_metrics (record_uri text PRIMARY KEY, play_count bigint)", .{});
    _ = try pool.exec("INSERT INTO plyr_index.account_availability VALUES ('a',true),('b',true),('c',false)", .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.track_records (record_uri,owner_did,collection,duration_seconds,deleted,self_labels) VALUES
        \\('public','a','fm.plyr.track',60,false,'{}'),('gated','b','fm.plyr.track',90,false,'{}'),
        \\('override','b','fm.plyr.track',30,false,'{copyright-violation}'),
        \\('private','a','fm.plyr.track',999,false,'{}'),('unlisted','a','fm.plyr.track',999,false,'{}'),
        \\('gone','a','fm.plyr.track',999,true,'{}'),('offline','c','fm.plyr.track',999,false,'{}'),
        \\('labeled','a','fm.plyr.track',999,false,'{copyright-violation}'),
        \\('excluded','a','fm.plyr.track',999,false,'{}'),('operator','a','fm.plyr.track',999,false,'{}'),
        \\('foreign','a','fm.other.track',999,false,'{}')
    , .{});
    _ = try pool.exec("INSERT INTO plyr_index.track_policies VALUES ('private','private',null,'[]'),('unlisted','unlisted',null,'[]'),('gated','supporters',null,'[]'),('override','public','allow','[]'),('excluded','public','exclude','[]'),('operator','public',null,'[\"copyright-violation\"]')", .{});
    _ = try pool.exec("INSERT INTO plyr_index.track_metrics VALUES ('public',7),('gated',3),('override',2),('private',100),('offline',100)", .{});
    var implementation: PostgresPlatformStatsStore = .{ .pool = pool, .io = io, .collection = "fm.plyr.track" };
    const store = implementation.store();
    const first = try store.get();
    try std.testing.expectEqual(@as(u64, 3), first.tracks);
    try std.testing.expectEqual(@as(u64, 2), first.artists);
    try std.testing.expectEqual(@as(u64, 180), first.duration_seconds);
    try std.testing.expectEqual(@as(u64, 12), first.plays);
    try std.testing.expect(first.updated_at_ms > 0);
    _ = try pool.exec("UPDATE plyr_index.track_metrics SET play_count=8 WHERE record_uri='public'", .{});
    try std.testing.expectEqual(first.plays, (try store.get()).plays);
    implementation.refreshed_ns -= 61 * std.time.ns_per_s;
    try std.testing.expectEqual(@as(u64, 13), (try store.get()).plays);
    var other: PostgresPlatformStatsStore = .{ .pool = pool, .io = io, .collection = "fm.empty.track" };
    const empty = try other.store().get();
    try std.testing.expectEqual(@as(u64, 0), empty.tracks);
    try std.testing.expectEqual(@as(u64, 0), empty.artists);
    try std.testing.expectEqual(@as(u64, 0), empty.duration_seconds);
    try std.testing.expectEqual(@as(u64, 0), empty.plays);
}
