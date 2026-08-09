//! PostgreSQL adapter for catalog-reconciliation discovery hints.
//!
//! The legacy app-view contributes DIDs only. Every record subsequently comes
//! from an authenticated current repository snapshot.

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
        var result = self.pool.query(candidate_query, .{}) catch |err| {
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
    \\  SELECT artist_did AS did
    \\  FROM public.tracks
    \\  WHERE atproto_record_uri IS NOT NULL AND atproto_record_cid IS NOT NULL
    \\  UNION
    \\  SELECT artist_did AS did
    \\  FROM public.albums
    \\  WHERE atproto_record_uri IS NOT NULL AND atproto_record_cid IS NOT NULL
    \\) AS source
    \\ORDER BY source.did
;

test "PostgreSQL candidates are distinct hints from canonical-looking legacy rows" {
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

    _ = try pool.exec("DROP TABLE IF EXISTS tracks CASCADE", .{});
    _ = try pool.exec("DROP TABLE IF EXISTS albums CASCADE", .{});
    _ = try pool.exec("CREATE TABLE tracks (artist_did text NOT NULL, atproto_record_uri text, atproto_record_cid text)", .{});
    _ = try pool.exec("CREATE TABLE albums (artist_did text NOT NULL, atproto_record_uri text, atproto_record_cid text)", .{});
    _ = try pool.exec(
        "INSERT INTO tracks VALUES ('did:plc:two', 'at://two/track/one', 'bafy'), ('did:plc:one', 'at://one/track/one', 'bafy'), ('did:plc:ignored', NULL, NULL)",
        .{},
    );
    _ = try pool.exec(
        "INSERT INTO albums VALUES ('did:plc:one', 'at://one/list/one', 'bafy')",
        .{},
    );

    var adapter: PostgresRepositoryCandidates = .{ .pool = pool };
    var found = try adapter.source().list(allocator);
    defer found.deinit(allocator);
    try std.testing.expectEqual(@as(usize, 2), found.items.len);
    try std.testing.expectEqualStrings("did:plc:one", found.items[0]);
    try std.testing.expectEqualStrings("did:plc:two", found.items[1]);
}
