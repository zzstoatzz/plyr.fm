//! Shared PostgreSQL pool for the projection stores.
//!
//! The legacy track queries over python's public.tracks/public.artists are
//! gone: every read now comes from plyr_index (see the composed store).

const std = @import("std");
const pg = @import("pg");
const postgres_url = @import("postgres_url.zig");

pub const PostgresTrackStore = struct {
    pool: *pg.Pool,

    pub fn init(
        allocator: std.mem.Allocator,
        io: std.Io,
        database_url: []const u8,
        pool_size: u16,
    ) !PostgresTrackStore {
        var normalized = try postgres_url.normalize(allocator, database_url);
        defer normalized.deinit(allocator);
        const uri = try std.Uri.parse(normalized.value);
        return .{ .pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = pool_size }) };
    }

    pub fn deinit(self: *PostgresTrackStore) void {
        self.pool.deinit();
    }

    pub fn requireRole(self: *PostgresTrackStore, expected_role: []const u8) !void {
        var query_row = (self.pool.row(
            "SELECT current_user = $1",
            .{expected_role},
        ) catch return error.DatabaseRoleUnavailable) orelse
            return error.DatabaseRoleUnavailable;
        var query_row_active = true;
        defer if (query_row_active) forceReleaseQueryRow(&query_row);

        const matches = query_row.get(bool, 0) catch return error.DatabaseRoleUnavailable;
        finishQueryRow(&query_row) catch return error.DatabaseRoleUnavailable;
        query_row_active = false;
        if (!matches) return error.UnexpectedDatabaseRole;
    }
};

/// Drain and release a successful result. pg.zig's QueryRow.deinit can fail
/// before releasing its connection, so force the Result cleanup on that path.
fn finishQueryRow(query_row: *pg.QueryRow) !void {
    query_row.deinit() catch |err| {
        query_row.result.deinit();
        return err;
    };
}

fn forceReleaseQueryRow(query_row: *pg.QueryRow) void {
    finishQueryRow(query_row) catch |err| {
        // finishQueryRow already released or poisoned the pooled connection.
        std.log.err("forced PostgreSQL result cleanup after error: {}", .{err});
    };
}
