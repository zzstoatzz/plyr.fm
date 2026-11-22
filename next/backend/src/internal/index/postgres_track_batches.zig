//! The composed track store's batch reads: tracks by URI, and each artist's
//! newest listed track. Same projection and policy as the store's other reads.

const std = @import("std");
const composed = @import("postgres_composed_track_store.zig");
const postgres_read = @import("postgres_read.zig");
const track = @import("../domain/track.zig");
const TrackStore = @import("track_store.zig").TrackStore;

pub fn resolve(context: *anyopaque, allocator: std.mem.Allocator, uris: []const []const u8) TrackStore.Error![]const track.Track {
    return postgres_read.run(TrackStore.Error![]const track.Track, resolveOnce, .{ context, allocator, uris });
}

fn resolveOnce(context: *anyopaque, allocator: std.mem.Allocator, uris: []const []const u8) postgres_read.Error![]const track.Track {
    const self: *composed.PostgresComposedTrackStore = @ptrCast(@alignCast(context));
    if (uris.len == 0) return &.{};
    const conn = self.pool.acquire() catch return error.IndexUnavailable;
    defer self.pool.release(conn);
    var result = conn.queryOpts(resolve_query, .{ uris, self.profile_collection, self.like_collection }, .{ .cache_name = "plyr_resolve_query" }) catch |err| return postgres_read.failure(conn, err);
    defer result.deinit();
    var values: std.ArrayList(track.Track) = .empty;
    errdefer values.deinit(allocator);
    while (result.next() catch |err| return postgres_read.failure(conn, err)) |row| {
        const value = composed.decodeRow(allocator, row) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.CorruptProjection;
        values.append(allocator, value) catch return error.OutOfMemory;
    }
    return values.toOwnedSlice(allocator) catch return error.OutOfMemory;
}

pub fn latestByArtists(context: *anyopaque, allocator: std.mem.Allocator, collection: []const u8, dids: []const []const u8, limit: usize) TrackStore.Error![]const track.Track {
    return postgres_read.run(TrackStore.Error![]const track.Track, latestByArtistsOnce, .{ context, allocator, collection, dids, limit });
}

fn latestByArtistsOnce(context: *anyopaque, allocator: std.mem.Allocator, collection: []const u8, dids: []const []const u8, limit: usize) postgres_read.Error![]const track.Track {
    const self: *composed.PostgresComposedTrackStore = @ptrCast(@alignCast(context));
    if (dids.len == 0 or limit == 0) return &.{};
    const conn = self.pool.acquire() catch return error.IndexUnavailable;
    defer self.pool.release(conn);
    var result = conn.queryOpts(latest_by_artists_query, .{
        collection,
        self.profile_collection,
        self.like_collection,
        dids,
        @as(i64, @intCast(limit)),
    }, .{ .cache_name = "plyr_latest_by_artists_query" }) catch |err| {
        composed.logQueryError(conn, "composed latest-by-artists query failed", err);
        return postgres_read.failure(conn, err);
    };
    defer result.deinit();
    var values: std.ArrayList(track.Track) = .empty;
    errdefer values.deinit(allocator);
    while (result.next() catch |err| return postgres_read.failure(conn, err)) |row| {
        const value = composed.decodeRow(allocator, row) catch |err| return if (err == error.OutOfMemory) error.OutOfMemory else error.CorruptProjection;
        values.append(allocator, value) catch return error.OutOfMemory;
    }
    return values.toOwnedSlice(allocator) catch return error.OutOfMemory;
}

const resolve_query = composed.joined_projection ++ "\n" ++
    \\WHERE v.record_uri = ANY($1::text[])
    \\  AND COALESCE(pol.visibility, 'public') <> 'private'
++ composed.common_policy;

const artists_policy = composed.common_policy ++ composed.published_policy ++
    \\  AND v.collection = $1
    \\  AND v.owner_did = ANY($4::text[])
    \\  AND COALESCE(pol.visibility, 'public') <> 'private'
;

/// Each artist's newest listed track (what the artist page lists first), then
/// the newest `$5` of those; the per-track joins run only for that page.
const latest_by_artists_query = "WITH latest AS MATERIALIZED (\nSELECT DISTINCT ON (v.owner_did) v.record_uri, v.record_created_at_us\n" ++ composed.page_from ++
    "\nWHERE v.record_created_at_us IS NOT NULL\n" ++ artists_policy ++
    "\nORDER BY v.owner_did, v.record_created_at_us DESC, v.record_uri DESC\n), page AS MATERIALIZED (\n" ++
    "SELECT latest.record_uri FROM latest ORDER BY latest.record_created_at_us DESC, latest.record_uri DESC LIMIT $5::bigint\n)\nSELECT\n" ++ composed.projected_columns ++
    "\nFROM page\nJOIN plyr_index.track_records AS v ON v.record_uri = page.record_uri\n" ++
    composed.projected_joins ++ "\n" ++ composed.page_order;
