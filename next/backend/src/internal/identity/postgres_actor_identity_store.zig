//! Actor presentation (handle, display name, avatar) owned by the appview.
//!
//! The refresher picks DIDs that own live plyr records and have no identity
//! row yet, or whose row is due. Results replace the row whole; a failed
//! refresh keeps the last good presentation and backs off.

const std = @import("std");
const pg = @import("pg");

pub const invalid_handle = "handle.invalid";

pub const Identity = struct {
    did: []const u8,
    handle: []const u8,
    display_name: []const u8,
    avatar_url: ?[]const u8,
    pds_origin: ?[]const u8,
};

pub const Error = error{ StoreUnavailable, CorruptProjection, OutOfMemory };

pub const PostgresActorIdentityStore = struct {
    pool: *pg.Pool,

    /// DIDs due for a refresh, never-seen first. Owned by `allocator`.
    pub fn due(
        self: PostgresActorIdentityStore,
        allocator: std.mem.Allocator,
        now_us: i64,
        limit: u32,
    ) Error![]const []const u8 {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        var result = conn.query(due_query, .{ now_us, @as(i64, limit) }) catch |err| {
            logError(conn, "actor identity due query failed", err);
            return error.StoreUnavailable;
        };
        defer result.deinit();
        var items: std.ArrayList([]const u8) = .empty;
        while (result.next() catch return error.StoreUnavailable) |row| {
            const did = row.get([]const u8, 0) catch return error.CorruptProjection;
            items.append(allocator, allocator.dupe(u8, did) catch return error.OutOfMemory) catch
                return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch error.OutOfMemory;
    }

    pub fn save(self: PostgresActorIdentityStore, identity: Identity, now_us: i64, next_us: i64) Error!void {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        _ = conn.exec(save_query, .{
            identity.did,
            identity.handle,
            identity.display_name,
            identity.avatar_url,
            identity.pds_origin,
            now_us,
            next_us,
        }) catch |err| {
            logError(conn, "actor identity write failed", err);
            return error.StoreUnavailable;
        };
    }

    /// Keeps any previous presentation; a DID never resolved gets a
    /// placeholder row so it stops blocking the queue until the backoff ends.
    pub fn recordFailure(self: PostgresActorIdentityStore, did: []const u8, now_us: i64) Error!void {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        _ = conn.exec(failure_query, .{ did, now_us }) catch |err| {
            logError(conn, "actor identity failure write failed", err);
            return error.StoreUnavailable;
        };
    }
};

fn logError(conn: *pg.Conn, message: []const u8, err: anyerror) void {
    if (conn.err) |pg_err|
        std.log.err("{s}: {}: {s}", .{ message, err, pg_err.message })
    else
        std.log.err("{s}: {}", .{ message, err });
}

const due_query =
    \\WITH owners AS (
    \\  SELECT owner_did FROM plyr_index.track_records WHERE NOT deleted
    \\  UNION SELECT owner_did FROM plyr_index.list_records WHERE NOT deleted
    \\  UNION SELECT owner_did FROM plyr_index.profile_records WHERE NOT deleted
    \\  UNION SELECT owner_did FROM plyr_index.like_records WHERE NOT deleted
    \\)
    \\SELECT owners.owner_did
    \\FROM owners
    \\LEFT JOIN plyr_index.actor_identities AS ai ON ai.did = owners.owner_did
    \\WHERE ai.did IS NULL OR ai.next_refresh_us <= $1
    \\  OR (ai.failures = 0 AND EXISTS (
    \\    SELECT 1 FROM plyr_index.profile_records AS pr
    \\    WHERE pr.owner_did = owners.owner_did AND pr.indexed_at_us > ai.refreshed_at_us
    \\  ))
    \\ORDER BY ai.next_refresh_us NULLS FIRST, owners.owner_did
    \\LIMIT $2
;

// A display name on the actor's own plyr profile wins over the bsky one, and
// a profile indexed after the last refresh makes the actor due again, so
// profile edits show up within one refresher pass.
const save_query =
    \\INSERT INTO plyr_index.actor_identities (
    \\  did, handle, display_name, avatar_url, pds_origin,
    \\  refreshed_at_us, next_refresh_us, failures
    \\) VALUES ($1, $2, COALESCE((
    \\  SELECT left(NULLIF(btrim(pr.display_name), ''), 640)
    \\  FROM plyr_index.profile_records AS pr
    \\  WHERE pr.owner_did = $1 AND pr.rkey = 'self' AND NOT pr.deleted
    \\  ORDER BY pr.indexed_at_us DESC LIMIT 1
    \\), $3), $4, $5, $6, $7, 0)
    \\ON CONFLICT (did) DO UPDATE SET
    \\  handle = EXCLUDED.handle,
    \\  display_name = EXCLUDED.display_name,
    \\  avatar_url = EXCLUDED.avatar_url,
    \\  pds_origin = EXCLUDED.pds_origin,
    \\  refreshed_at_us = EXCLUDED.refreshed_at_us,
    \\  next_refresh_us = EXCLUDED.next_refresh_us,
    \\  failures = 0
;

// Backoff: one minute doubling per consecutive failure, capped at six hours.
const failure_query =
    \\INSERT INTO plyr_index.actor_identities AS ai (
    \\  did, handle, display_name, avatar_url, pds_origin,
    \\  refreshed_at_us, next_refresh_us, failures
    \\) VALUES ($1, 'handle.invalid', $1, NULL, NULL, $2, $2 + 60000000, 1)
    \\ON CONFLICT (did) DO UPDATE SET
    \\  failures = ai.failures + 1,
    \\  next_refresh_us = $2 + LEAST(
    \\    60000000::bigint * (1::bigint << LEAST(ai.failures + 1, 9)),
    \\    21600000000::bigint
    \\  )
;

/// Test fixture matching migrations/0023.
pub fn createTestTable(pool: *pg.Pool) !void {
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.actor_identities (
        \\  did text PRIMARY KEY, handle text NOT NULL, display_name text NOT NULL,
        \\  avatar_url text, pds_origin text, refreshed_at_us bigint NOT NULL,
        \\  next_refresh_us bigint NOT NULL, failures integer NOT NULL DEFAULT 0
        \\)
    , .{});
}

/// Test helper: a resolved identity row.
pub fn insertTestIdentity(
    pool: *pg.Pool,
    did: []const u8,
    handle: []const u8,
    display_name: []const u8,
    avatar_url: ?[]const u8,
) !void {
    _ = try pool.exec(
        "INSERT INTO plyr_index.actor_identities VALUES ($1, $2, $3, $4, NULL, 0, 0, 0)",
        .{ did, handle, display_name, avatar_url },
    );
}

test "PostgreSQL identities prefer the plyr profile name and refresh on profile edits" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    const lock = @import("../testing/postgres_lock.zig");
    lock.lock(io);
    defer lock.unlock(io);
    const database_uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, database_uri, .{ .size = 1 });
    defer pool.deinit();
    {
        var row = (try pool.row("SELECT current_database()", .{})).?;
        defer row.deinit() catch {};
        if (!std.mem.eql(u8, try row.get([]const u8, 0), "zig_test")) return error.UnsafeTestDatabase;
    }
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    try createTestTable(pool);
    try @import("../projection/postgres_profile_store.zig").createTestTable(pool);
    inline for (.{ "track_records", "list_records", "like_records" }) |table|
        _ = try pool.exec("CREATE TABLE plyr_index." ++ table ++ " (owner_did text NOT NULL, deleted boolean NOT NULL)", .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.profile_records (record_uri, record_cid, owner_did, collection,
        \\  rkey, record_created_at, deleted, commit_cid, commit_rev, indexed_at_us, display_name)
        \\VALUES ('at://did:plc:a/fm.plyr.stg.actor.profile/self', 'cid', 'did:plc:a',
        \\  'fm.plyr.stg.actor.profile', 'self', '2026-11-03T00:00:00Z', false, 'c', 'r', 100, ' plyr name ')
    , .{});

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const store: PostgresActorIdentityStore = .{ .pool = pool };
    try std.testing.expectEqual(@as(usize, 1), (try store.due(arena.allocator(), 0, 10)).len);
    try store.save(.{
        .did = "did:plc:a",
        .handle = "a.example",
        .display_name = "bsky name",
        .avatar_url = null,
        .pds_origin = null,
    }, 200, 10_000);
    try expectDisplayName(pool, "plyr name");
    try std.testing.expectEqual(@as(usize, 0), (try store.due(arena.allocator(), 300, 10)).len);

    // An edit indexed after the refresh makes the actor due before its timer.
    _ = try pool.exec("UPDATE plyr_index.profile_records SET display_name = NULL, indexed_at_us = 400", .{});
    try std.testing.expectEqual(@as(usize, 1), (try store.due(arena.allocator(), 500, 10)).len);
    try store.save(.{
        .did = "did:plc:a",
        .handle = "a.example",
        .display_name = "bsky name",
        .avatar_url = null,
        .pds_origin = null,
    }, 600, 10_000);
    try expectDisplayName(pool, "bsky name");
    try std.testing.expectEqual(@as(usize, 0), (try store.due(arena.allocator(), 700, 10)).len);
}

fn expectDisplayName(pool: *pg.Pool, expected: []const u8) !void {
    var row = (try pool.row("SELECT display_name FROM plyr_index.actor_identities WHERE did = 'did:plc:a'", .{})).?;
    defer row.deinit() catch {};
    try std.testing.expectEqualStrings(expected, try row.get([]const u8, 0));
}
