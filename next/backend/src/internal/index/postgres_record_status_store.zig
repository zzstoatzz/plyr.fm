//! Record status across every projected collection plus rejections.

const std = @import("std");
const pg = @import("pg");
const store_module = @import("record_status_store.zig");

const RecordStatusStore = store_module.RecordStatusStore;

pub const PostgresRecordStatusStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresRecordStatusStore) RecordStatusStore {
        return .{ .context = self, .get_fn = getOpaque };
    }

    fn getOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        record_uri: []const u8,
    ) RecordStatusStore.Error!?store_module.Status {
        const self: *PostgresRecordStatusStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        var row = (conn.row(status_query, .{record_uri}) catch |err| {
            if (conn.err) |pg_err|
                std.log.err("record status query failed: {}: {s}", .{ err, pg_err.message })
            else
                std.log.err("record status query failed: {}", .{err});
            return error.IndexUnavailable;
        }) orelse return null;
        defer row.deinit() catch {};
        const state_text = row.get([]const u8, 0) catch return error.CorruptProjection;
        const state = std.meta.stringToEnum(store_module.State, state_text) orelse
            return error.CorruptProjection;
        const cid = row.get(?[]const u8, 1) catch return error.CorruptProjection;
        const reason = row.get(?[]const u8, 2) catch return error.CorruptProjection;
        return .{
            .state = state,
            .record_cid = if (cid) |value| try allocator.dupe(u8, value) else null,
            .reason = if (reason) |value| try allocator.dupe(u8, value) else null,
        };
    }
};

// A record lives in at most one projection table; a rejection only exists
// while no valid version is projected, but prefer the projection if both do.
const status_query =
    \\SELECT state, record_cid, reason FROM (
    \\  SELECT CASE WHEN deleted THEN 'deleted' ELSE 'indexed' END AS state,
    \\    record_cid, NULL::text AS reason, 0 AS priority
    \\  FROM plyr_index.track_records WHERE record_uri = $1
    \\  UNION ALL
    \\  SELECT CASE WHEN deleted THEN 'deleted' ELSE 'indexed' END,
    \\    record_cid, NULL::text, 0
    \\  FROM plyr_index.list_records WHERE record_uri = $1
    \\  UNION ALL
    \\  SELECT CASE WHEN deleted THEN 'deleted' ELSE 'indexed' END,
    \\    record_cid, NULL::text, 0
    \\  FROM plyr_index.like_records WHERE record_uri = $1
    \\  UNION ALL
    \\  SELECT CASE WHEN deleted THEN 'deleted' ELSE 'indexed' END,
    \\    record_cid, NULL::text, 0
    \\  FROM plyr_index.profile_records WHERE record_uri = $1
    \\  UNION ALL
    \\  SELECT 'rejected', record_cid, reason, 1
    \\  FROM plyr_index.record_rejections WHERE record_uri = $1
    \\) AS status
    \\ORDER BY priority
    \\LIMIT 1
;

test "PostgreSQL record status prefers projections over rejections" {
    const postgres_test_lock = @import("../testing/postgres_lock.zig");
    const postgres_list = @import("../projection/postgres_list_store.zig");
    const postgres_track = @import("../projection/postgres_track_store.zig");
    const postgres_profile = @import("../projection/postgres_profile_store.zig");
    const postgres_like = @import("../projection/postgres_like_store.zig");
    const postgres_rejections = @import("../projection/postgres_record_rejection_store.zig");
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    {
        var row = (try pool.row("SELECT current_database()", .{})).?;
        defer row.deinit() catch {};
        if (!std.mem.eql(u8, try row.get([]const u8, 0), "zig_test")) return error.UnsafeTestDatabase;
    }
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    try postgres_list.createTestSchema(pool);
    try postgres_track.createTestTable(pool);
    try postgres_profile.createTestTable(pool);
    try postgres_like.createTestTable(pool);
    try postgres_rejections.createTestTable(pool);

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var implementation: PostgresRecordStatusStore = .{ .pool = pool };
    const status_store = implementation.store();
    const like_uri = "at://did:plc:a/fm.plyr.dev.like/3k";
    try std.testing.expect((try status_store.get(a, like_uri)) == null);

    _ = try pool.exec(
        \\INSERT INTO plyr_index.record_rejections (record_uri, record_cid, owner_did,
        \\  collection, rkey, reason, detail, commit_cid, commit_rev, indexed_at_us)
        \\VALUES ($1, 'bafyrejected', 'did:plc:a', 'fm.plyr.dev.like', '3k',
        \\  'invalid_schema', 'InvalidSubjectCid', 'bafycommit', '3kaaaaaaaaaaa', 1)
    , .{like_uri});
    const rejected = (try status_store.get(a, like_uri)).?;
    try std.testing.expectEqual(store_module.State.rejected, rejected.state);
    try std.testing.expectEqualStrings("bafyrejected", rejected.record_cid.?);
    try std.testing.expectEqualStrings("invalid_schema", rejected.reason.?);
}
