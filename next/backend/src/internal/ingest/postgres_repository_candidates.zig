//! PostgreSQL adapter for catalog-reconciliation discovery hints.
//!
//! Hints are DIDs the projection has already seen (repo heads and record
//! owners). Every record subsequently comes from an authenticated current
//! repository snapshot. Python's public tables are no longer consulted.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const candidates = @import("repository_candidates.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");

pub const PostgresRepositoryCandidates = struct {
    pool: *pg.Pool,

    pub fn source(self: *PostgresRepositoryCandidates) candidates.Source {
        return .{ .context = self, .list_fn = listOpaque };
    }

    fn listOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
    ) candidates.Error!candidates.CandidateSet {
        const self: *PostgresRepositoryCandidates = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch |err| {
            std.log.err("catalog candidate connection failed: {}", .{err});
            return error.SourceUnavailable;
        };
        defer self.pool.release(conn);
        var result = conn.query(candidate_query, .{}) catch |err| {
            if (conn.err) |pg_err|
                std.log.err("catalog candidate query failed: {}: {s}", .{ err, pg_err.message })
            else
                std.log.err("catalog candidate query failed: {}", .{err});
            return error.SourceUnavailable;
        };
        defer result.deinit();

        var items: std.ArrayListUnmanaged([]u8) = .empty;
        errdefer {
            for (items.items) |item| allocator.free(item);
            items.deinit(allocator);
        }
        while (result.next() catch |err| {
            std.log.err("catalog candidate result failed: {}", .{err});
            return error.SourceUnavailable;
        }) |row| {
            const did = row.get([]const u8, 0) catch return error.CorruptSource;
            if (zat.Did.parse(did) == null) return error.CorruptSource;
            const owned = allocator.dupe(u8, did) catch return error.OutOfMemory;
            errdefer allocator.free(owned);
            items.append(allocator, owned) catch return error.OutOfMemory;
        }
        return .{ .items = items.toOwnedSlice(allocator) catch return error.OutOfMemory };
    }
};

const candidate_query =
    \\SELECT source.did
    \\FROM (
    \\  SELECT repo_did AS did FROM plyr_index.repo_heads
    \\  UNION SELECT owner_did FROM plyr_index.track_records
    \\  UNION SELECT owner_did FROM plyr_index.list_records
    \\  UNION SELECT owner_did FROM plyr_index.like_records
    \\  UNION SELECT owner_did FROM plyr_index.comment_records
    \\  UNION SELECT owner_did FROM plyr_index.profile_records
    \\) AS source
    \\ORDER BY source.did
;

test "PostgreSQL candidates are distinct DIDs the projection has seen" {
    const database_url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse
        return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);

    const database_uri = try std.Uri.parse(std.mem.span(database_url_z));
    var pool = try pg.Pool.initUri(io, allocator, database_uri, .{ .size = 1 });
    defer pool.deinit();
    var database_row = (try pool.row("SELECT current_database()", .{})).?;
    const database_name = try allocator.dupe(u8, try database_row.get([]const u8, 0));
    defer allocator.free(database_name);
    try database_row.deinit();
    if (!std.mem.eql(u8, database_name, "zig_test")) return error.UnsafeTestDatabase;

    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.repo_heads (repo_did text PRIMARY KEY)", .{});
    inline for (.{ "track_records", "list_records", "like_records", "comment_records", "profile_records" }) |table|
        _ = try pool.exec("CREATE TABLE plyr_index." ++ table ++ " (owner_did text NOT NULL)", .{});
    _ = try pool.exec("INSERT INTO plyr_index.repo_heads VALUES ('did:plc:two')", .{});
    _ = try pool.exec("INSERT INTO plyr_index.track_records VALUES ('did:plc:two'), ('did:plc:one')", .{});
    _ = try pool.exec("INSERT INTO plyr_index.list_records VALUES ('did:plc:one')", .{});
    _ = try pool.exec("INSERT INTO plyr_index.like_records VALUES ('did:plc:three')", .{});
    _ = try pool.exec("INSERT INTO plyr_index.comment_records VALUES ('did:plc:four')", .{});

    var adapter: PostgresRepositoryCandidates = .{ .pool = pool };
    var found = try adapter.source().list(allocator);
    defer found.deinit(allocator);
    try std.testing.expectEqual(@as(usize, 4), found.items.len);
    try std.testing.expectEqualStrings("did:plc:four", found.items[0]);
    try std.testing.expectEqualStrings("did:plc:one", found.items[1]);
    try std.testing.expectEqualStrings("did:plc:three", found.items[2]);
    try std.testing.expectEqualStrings("did:plc:two", found.items[3]);
}
