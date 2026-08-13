//! PostgreSQL adapter for durable PDS command idempotency keys.

const std = @import("std");
const pg = @import("pg");
const key_store = @import("record_key_store.zig");

pub const PostgresRecordKeyStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresRecordKeyStore) key_store.Store {
        return .{
            .context = self,
            .reserve_fn = reserveOpaque,
            .get_fn = getOpaque,
            .release_fn = releaseOpaque,
        };
    }

    fn reserveOpaque(context: *anyopaque, allocator: std.mem.Allocator, candidate: key_store.Candidate) !key_store.Reservation {
        const self: *PostgresRecordKeyStore = @ptrCast(@alignCast(context));
        return self.reserve(allocator, candidate);
    }

    fn getOpaque(context: *anyopaque, allocator: std.mem.Allocator, key: key_store.Key) !?key_store.Reservation {
        const self: *PostgresRecordKeyStore = @ptrCast(@alignCast(context));
        return self.get(allocator, key);
    }

    fn releaseOpaque(context: *anyopaque, key: key_store.Key, rkey: []const u8) !bool {
        const self: *PostgresRecordKeyStore = @ptrCast(@alignCast(context));
        return self.release(key, rkey);
    }

    pub fn reserve(
        self: PostgresRecordKeyStore,
        allocator: std.mem.Allocator,
        candidate: key_store.Candidate,
    ) !key_store.Reservation {
        var query_row = (try self.pool.row(
            \\INSERT INTO plyr_command.record_keys
            \\  (actor_did, collection, operation_digest, rkey, created_at)
            \\VALUES ($1, $2, $3::bytea, $4, $5)
            \\ON CONFLICT (actor_did, collection, operation_digest)
            \\DO UPDATE SET operation_digest = plyr_command.record_keys.operation_digest
            \\RETURNING rkey, created_at
        , .{
            candidate.actor_did,
            candidate.collection,
            candidate.operation_digest[0..],
            candidate.rkey,
            candidate.created_at,
        })) orelse return error.UnexpectedRowCount;
        defer query_row.deinit() catch query_row.result.deinit();
        return .{
            .rkey = try allocator.dupe(u8, try query_row.row.get([]const u8, 0)),
            .created_at = try allocator.dupe(u8, try query_row.row.get([]const u8, 1)),
        };
    }

    pub fn get(
        self: PostgresRecordKeyStore,
        allocator: std.mem.Allocator,
        key: key_store.Key,
    ) !?key_store.Reservation {
        var query_row = try self.pool.row(
            \\SELECT rkey, created_at
            \\FROM plyr_command.record_keys
            \\WHERE actor_did = $1 AND collection = $2
            \\  AND operation_digest = $3::bytea
        , .{ key.actor_did, key.collection, key.operation_digest[0..] }) orelse return null;
        defer query_row.deinit() catch query_row.result.deinit();
        return .{
            .rkey = try allocator.dupe(u8, try query_row.row.get([]const u8, 0)),
            .created_at = try allocator.dupe(u8, try query_row.row.get([]const u8, 1)),
        };
    }

    pub fn release(
        self: PostgresRecordKeyStore,
        key: key_store.Key,
        rkey: []const u8,
    ) !bool {
        const affected = try self.pool.exec(
            \\DELETE FROM plyr_command.record_keys
            \\WHERE actor_did = $1 AND collection = $2
            \\  AND operation_digest = $3::bytea AND rkey = $4
        , .{ key.actor_did, key.collection, key.operation_digest[0..], rkey });
        return affected == 1;
    }
};

test "Postgres record key reservations are stable and conditionally released" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const io = std.Options.debug_io;
    const postgres_lock = @import("../testing/postgres_lock.zig");
    postgres_lock.lock(io);
    defer postgres_lock.unlock(io);

    var database = try @import("../index/postgres_track_store.zig").PostgresTrackStore.init(
        std.testing.allocator,
        io,
        std.mem.span(url_z),
        2,
    );
    defer database.deinit();
    var database_row = (try database.pool.row("SELECT current_database()", .{})).?;
    const database_name = try std.testing.allocator.dupe(u8, try database_row.get([]const u8, 0));
    defer std.testing.allocator.free(database_name);
    try database_row.deinit();
    if (!std.mem.eql(u8, database_name, "zig_test")) return error.UnsafeTestDatabase;

    _ = try database.pool.exec("DROP SCHEMA IF EXISTS plyr_command CASCADE", .{});
    _ = try database.pool.exec("CREATE SCHEMA plyr_command", .{});
    defer _ = database.pool.exec("DROP SCHEMA IF EXISTS plyr_command CASCADE", .{}) catch null;
    _ = try database.pool.exec(
        \\CREATE TABLE plyr_command.record_keys (
        \\  actor_did text NOT NULL, collection text NOT NULL,
        \\  operation_digest bytea NOT NULL, rkey text NOT NULL,
        \\  created_at text NOT NULL,
        \\  PRIMARY KEY (actor_did, collection, operation_digest),
        \\  UNIQUE (actor_did, collection, rkey)
        \\)
    , .{});

    var postgres: PostgresRecordKeyStore = .{ .pool = database.pool };
    const store = postgres.store();
    const operation_digest = key_store.digest(&.{ "at://subject", "cid" });
    var first = try store.reserve(std.testing.allocator, .{
        .actor_did = "did:plc:listener",
        .collection = "fm.plyr.dev.like",
        .operation_digest = operation_digest,
        .rkey = "3mfirstkey222",
        .created_at = "2026-08-13T01:02:03.000000Z",
    });
    defer first.deinit(std.testing.allocator);
    var repeated = try store.reserve(std.testing.allocator, .{
        .actor_did = "did:plc:listener",
        .collection = "fm.plyr.dev.like",
        .operation_digest = operation_digest,
        .rkey = "3motherkey22",
        .created_at = "2026-08-13T02:00:00.000000Z",
    });
    defer repeated.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings(first.rkey, repeated.rkey);
    try std.testing.expectEqualStrings(first.created_at, repeated.created_at);
    const key: key_store.Key = .{
        .actor_did = "did:plc:listener",
        .collection = "fm.plyr.dev.like",
        .operation_digest = operation_digest,
    };
    var loaded = (try store.get(std.testing.allocator, key)).?;
    defer loaded.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings(first.rkey, loaded.rkey);
    try std.testing.expect(!try store.release(key, "3mwrongkey222"));
    try std.testing.expect(try store.release(key, first.rkey));
    try std.testing.expect((try store.get(std.testing.allocator, key)) == null);
}
