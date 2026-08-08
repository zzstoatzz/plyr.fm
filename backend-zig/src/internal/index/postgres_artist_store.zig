//! PostgreSQL adapter for the rebuildable public artist projection.
//!
//! The adapter borrows the catalog's existing pool. Artist reads therefore add
//! no second Neon pool, and the application boundary remains independent of
//! the legacy `artists` and `user_preferences` table layout.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const artist = @import("../domain/artist.zig");
const artist_index = @import("artist_store.zig");
const ArtistStore = artist_index.ArtistStore;

pub const PostgresArtistStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresArtistStore) ArtistStore {
        return .{ .context = self, .get_fn = getOpaque };
    }

    fn getOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        identifier: artist_index.Identifier,
    ) ArtistStore.Error!?artist.Artist {
        const self: *PostgresArtistStore = @ptrCast(@alignCast(context));
        return self.get(allocator, identifier);
    }

    fn get(
        self: *PostgresArtistStore,
        allocator: std.mem.Allocator,
        identifier: artist_index.Identifier,
    ) ArtistStore.Error!?artist.Artist {
        var result = switch (identifier) {
            .did => |did| self.pool.query(detail_by_did_query, .{did}),
            .handle => |handle| self.pool.query(detail_by_handle_query, .{handle}),
        } catch |err| {
            std.log.err("PostgreSQL artist lookup failed: {}", .{err});
            return error.IndexUnavailable;
        };
        defer result.deinit();

        const first = result.next() catch |err| {
            std.log.err("PostgreSQL artist result read failed: {}", .{err});
            return error.IndexUnavailable;
        } orelse return null;
        const value = decodeRow(allocator, &first) catch |err| switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => {
                std.log.err("artist projection decode failed: {}", .{err});
                return error.CorruptProjection;
            },
        };

        // A handle is an alias for one DID. Treat an ambiguous legacy
        // projection as corruption rather than returning an arbitrary owner.
        if (result.next() catch |err| {
            std.log.err("PostgreSQL artist uniqueness check failed: {}", .{err});
            return error.IndexUnavailable;
        } != null) return error.CorruptProjection;

        return value;
    }

    fn decodeRow(allocator: std.mem.Allocator, row: anytype) !artist.Artist {
        const did = try duplicate(allocator, try row.get([]const u8, 0));
        if (zat.Did.parse(did) == null) return error.CorruptArtistDid;
        const handle = try duplicate(allocator, try row.get([]const u8, 1));
        if (zat.Handle.parse(handle) == null) return error.CorruptArtistHandle;

        return .{
            .did = did,
            .handle = handle,
            .display_name = try duplicate(allocator, try row.get([]const u8, 2)),
            .bio = try duplicateOptional(allocator, try row.get(?[]const u8, 3)),
            .avatar_url = try duplicateOptional(allocator, try row.get(?[]const u8, 4)),
            .show_liked_on_profile = try row.get(bool, 5),
            .support_url = try duplicateOptional(allocator, try row.get(?[]const u8, 6)),
            .created_at = try duplicate(allocator, try row.get([]const u8, 7)),
            .updated_at = try duplicate(allocator, try row.get([]const u8, 8)),
            .sources = .{
                .identity = .legacy_projection,
                .profile = .legacy_projection,
                .public_preferences = .legacy_local,
            },
            .projection = .{ .indexed_at = null, .verification = .legacy_unverified },
        };
    }
};

const select_fields =
    \\SELECT
    \\  a.did,
    \\  lower(a.handle),
    \\  a.display_name,
    \\  a.bio,
    \\  a.avatar_url,
    \\  COALESCE(p.show_liked_on_profile, false),
    \\  p.support_url,
    \\  to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    \\  to_char(a.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    \\FROM artists AS a
    \\LEFT JOIN user_preferences AS p ON p.did = a.did
;

const detail_by_did_query = select_fields ++ "\n" ++
    \\WHERE a.did = $1
    \\  AND a.deactivated = false
    \\LIMIT 2
;

const detail_by_handle_query = select_fields ++ "\n" ++
    \\WHERE lower(a.handle) = $1
    \\  AND a.deactivated = false
    \\LIMIT 2
;

fn duplicate(allocator: std.mem.Allocator, value: []const u8) ![]const u8 {
    return allocator.dupe(u8, value);
}

fn duplicateOptional(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    return if (value) |present| try duplicate(allocator, present) else null;
}
