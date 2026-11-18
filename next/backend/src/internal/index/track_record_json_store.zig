//! The verified track records themselves, as atproto JSON, for read surfaces
//! that hand other apps the record as the artist wrote it.

const std = @import("std");
const pg = @import("pg");

pub const Entry = struct {
    uri: []const u8,
    cid: []const u8,
    json: []const u8,
};

pub const Store = struct {
    context: *anyopaque,
    lookup_fn: *const fn (*anyopaque, std.mem.Allocator, []const []const u8) Error![]Entry,

    pub const Error = error{ IndexUnavailable, OutOfMemory };

    /// Current records for `uris`. Deleted records, and records projected
    /// before their JSON was kept, are absent.
    pub fn lookup(self: Store, allocator: std.mem.Allocator, uris: []const []const u8) Error![]Entry {
        if (uris.len == 0) return &.{};
        return self.lookup_fn(self.context, allocator, uris);
    }
};

pub const PostgresStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresStore) Store {
        return .{ .context = self, .lookup_fn = lookupOpaque };
    }

    fn lookupOpaque(context: *anyopaque, allocator: std.mem.Allocator, uris: []const []const u8) Store.Error![]Entry {
        const self: *PostgresStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.IndexUnavailable;
        defer self.pool.release(conn);
        var result = conn.query(lookup_sql, .{uris}) catch |err| {
            if (conn.err) |pg_err|
                std.log.err("track record json query failed: {}: {s}", .{ err, pg_err.message })
            else
                std.log.err("track record json query failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer result.deinit();
        var entries: std.ArrayList(Entry) = .empty;
        while (result.next() catch return error.IndexUnavailable) |row| {
            const uri = row.get([]const u8, 0) catch return error.IndexUnavailable;
            const cid = row.get([]const u8, 1) catch return error.IndexUnavailable;
            const json = row.get([]const u8, 2) catch return error.IndexUnavailable;
            try entries.append(allocator, .{
                .uri = try allocator.dupe(u8, uri),
                .cid = try allocator.dupe(u8, cid),
                .json = try allocator.dupe(u8, json),
            });
        }
        return entries.toOwnedSlice(allocator);
    }
};

const lookup_sql =
    \\SELECT record_uri, record_cid, record_json::text
    \\FROM plyr_index.track_records
    \\WHERE record_uri = ANY($1::text[]) AND NOT deleted AND record_json IS NOT NULL
;
