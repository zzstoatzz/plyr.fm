//! PostgreSQL adapter for radio: the corpus and rotation reads come from the
//! projection; `plyr_playback.radio_rotations` is the radio's own pin table
//! and this module is its only writer.

const std = @import("std");
const pg = @import("pg");
const composed = @import("../index/postgres_composed_track_store.zig");
const track_tag_sql = @import("../index/track_tag_sql.zig");
const station_module = @import("station.zig");
const sampler = @import("sampler.zig");
const store_module = @import("store.zig");

const Candidate = station_module.Candidate;
const Entry = sampler.Entry;
const RadioStore = store_module.RadioStore;
const Error = store_module.Error;
const log = std.log.scoped(.radio_store);

pub const PostgresRadioStore = struct {
    pool: *pg.Pool,

    const vtable: RadioStore.VTable = .{
        .corpus = corpusOpaque,
        .tracks = tracksOpaque,
        .pin = pinOpaque,
        .peek = peekOpaque,
        .pinAnchor = pinAnchorOpaque,
    };

    pub fn store(self: *PostgresRadioStore) RadioStore {
        return .{ .context = self, .vtable = &vtable };
    }

    fn acquire(self: *PostgresRadioStore) Error!*pg.Conn {
        return self.pool.acquire() catch |err| {
            log.err("radio connection failed: {}", .{err});
            return error.IndexUnavailable;
        };
    }

    fn corpusOpaque(context: *anyopaque, allocator: std.mem.Allocator, collections: store_module.Collections, hidden: []const []const u8) Error![]Candidate {
        const self: *PostgresRadioStore = @ptrCast(@alignCast(context));
        const conn = try self.acquire();
        defer self.pool.release(conn);
        var result = conn.query(corpus_query, .{ collections.track, collections.like, hidden }) catch |err| return failure(conn, "radio corpus", err);
        defer result.deinit();
        var candidates: std.ArrayList(Candidate) = .empty;
        while (result.next() catch |err| return failure(conn, "radio corpus row", err)) |row| {
            candidates.append(allocator, decodeCandidate(allocator, row) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            }) catch return error.OutOfMemory;
        }
        return candidates.toOwnedSlice(allocator) catch error.OutOfMemory;
    }

    fn tracksOpaque(context: *anyopaque, allocator: std.mem.Allocator, collections: store_module.Collections, uris: []const []const u8) Error![]store_module.Hydrated {
        const self: *PostgresRadioStore = @ptrCast(@alignCast(context));
        if (uris.len == 0) return &.{};
        const conn = try self.acquire();
        defer self.pool.release(conn);
        var result = conn.query(tracks_query, .{ collections.track, collections.profile, collections.like, uris }) catch |err| return failure(conn, "radio tracks", err);
        defer result.deinit();
        var tracks: std.ArrayList(store_module.Hydrated) = .empty;
        while (result.next() catch |err| return failure(conn, "radio tracks row", err)) |row| {
            const value = composed.decodeRow(allocator, row) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            };
            const raw_tags = row.get([]const u8, composed.projected_column_count) catch return error.CorruptProjection;
            const tags = std.json.parseFromSliceLeaky([]const []const u8, allocator, raw_tags, .{ .allocate = .alloc_always }) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            };
            tracks.append(allocator, .{ .value = value, .tags = tags }) catch return error.OutOfMemory;
        }
        return tracks.toOwnedSlice(allocator) catch error.OutOfMemory;
    }

    fn pinOpaque(context: *anyopaque, allocator: std.mem.Allocator, key: store_module.Key, entries: []const Entry) Error![]Entry {
        const self: *PostgresRadioStore = @ptrCast(@alignCast(context));
        const body = encodeEntries(allocator, entries) catch return error.OutOfMemory;
        const conn = try self.acquire();
        defer self.pool.release(conn);
        var transaction = try Writable.begin(conn);
        defer transaction.rollbackUnlessCommitted();
        _ = conn.exec(prune_sql, .{ key.station, key.period - 2 }) catch |err| return failure(conn, "radio prune", err);
        // first writer wins: a concurrent build reads back the winner's rotation
        _ = conn.exec(pin_sql, .{ key.station, @as(i32, @intCast(key.size)), key.period, body }) catch |err| return failure(conn, "radio pin", err);
        const pinned = try peekWith(conn, allocator, key) orelse return error.IndexUnavailable;
        try transaction.commit();
        return pinned.entries;
    }

    fn peekOpaque(context: *anyopaque, allocator: std.mem.Allocator, key: store_module.Key) Error!?RadioStore.Pinned {
        const self: *PostgresRadioStore = @ptrCast(@alignCast(context));
        const conn = try self.acquire();
        defer self.pool.release(conn);
        return peekWith(conn, allocator, key);
    }

    fn pinAnchorOpaque(context: *anyopaque, key: store_module.Key, anchor_us: i64) Error!?i64 {
        const self: *PostgresRadioStore = @ptrCast(@alignCast(context));
        const conn = try self.acquire();
        defer self.pool.release(conn);
        var transaction = try Writable.begin(conn);
        defer transaction.rollbackUnlessCommitted();
        var anchor: ?i64 = null;
        {
            var result = conn.query(anchor_sql, .{ key.station, @as(i32, @intCast(key.size)), key.period, anchor_us }) catch |err| return failure(conn, "radio anchor", err);
            defer result.deinit();
            while (result.next() catch |err| return failure(conn, "radio anchor row", err)) |row| {
                anchor = row.get(i64, 0) catch return error.CorruptProjection;
            }
        }
        try transaction.commit();
        return anchor;
    }
};

/// The api's role defaults to read-only transactions; pins are its own
/// writes, so they ask for a writable transaction explicitly.
const Writable = struct {
    conn: *pg.Conn,
    committed: bool = false,

    fn begin(conn: *pg.Conn) Error!Writable {
        _ = conn.exec("BEGIN READ WRITE", .{}) catch |err| return failure(conn, "radio begin", err);
        return .{ .conn = conn };
    }

    fn commit(self: *Writable) Error!void {
        _ = self.conn.exec("COMMIT", .{}) catch |err| return failure(self.conn, "radio commit", err);
        self.committed = true;
    }

    fn rollbackUnlessCommitted(self: *Writable) void {
        if (!self.committed) _ = self.conn.exec("ROLLBACK", .{}) catch {};
    }
};

fn peekWith(conn: *pg.Conn, allocator: std.mem.Allocator, key: store_module.Key) Error!?RadioStore.Pinned {
    var result = conn.query(peek_sql, .{ key.station, @as(i32, @intCast(key.size)), key.period }) catch |err| return failure(conn, "radio peek", err);
    defer result.deinit();
    var pinned: ?RadioStore.Pinned = null;
    while (result.next() catch |err| return failure(conn, "radio peek row", err)) |row| {
        const raw = row.get([]const u8, 0) catch return error.CorruptProjection;
        pinned = .{
            .entries = decodeEntries(allocator, raw) catch |err| switch (err) {
                error.OutOfMemory => return error.OutOfMemory,
                else => return error.CorruptProjection,
            },
            .anchor_us = row.get(?i64, 1) catch return error.CorruptProjection,
        };
    }
    return pinned;
}

fn failure(conn: *pg.Conn, what: []const u8, err: anyerror) Error {
    if (err == error.OutOfMemory) return error.OutOfMemory;
    if (conn.err) |pg_err|
        log.err("{s} failed: {}: {s}", .{ what, err, pg_err.message })
    else
        log.err("{s} failed: {}", .{ what, err });
    return error.IndexUnavailable;
}

fn decodeCandidate(allocator: std.mem.Allocator, row: anytype) !Candidate {
    return .{
        .uri = try allocator.dupe(u8, try row.get([]const u8, 0)),
        .owner_did = try allocator.dupe(u8, try row.get([]const u8, 1)),
        .handle = try allocator.dupe(u8, try row.get([]const u8, 2)),
        .duration_seconds = try row.get(i64, 3),
        .created_at_us = try row.get(i64, 4),
        .play_count = try row.get(i64, 5),
        .like_count = try row.get(i64, 6),
        .hidden = try row.get(bool, 7),
    };
}

const StoredEntry = struct { uri: []const u8, did: []const u8, duration: i64 };

pub fn encodeEntries(allocator: std.mem.Allocator, entries: []const Entry) ![]const u8 {
    const stored = try allocator.alloc(StoredEntry, entries.len);
    for (entries, stored) |entry, *slot| slot.* = .{ .uri = entry.uri, .did = entry.owner_did, .duration = entry.duration_seconds };
    return std.json.Stringify.valueAlloc(allocator, stored, .{});
}

pub fn decodeEntries(allocator: std.mem.Allocator, raw: []const u8) ![]Entry {
    const stored = try std.json.parseFromSliceLeaky([]const StoredEntry, allocator, raw, .{ .allocate = .alloc_always });
    const entries = try allocator.alloc(Entry, stored.len);
    for (stored, entries) |value, *entry| {
        if (value.duration <= 0) return error.CorruptRotation;
        entry.* = .{ .uri = value.uri, .owner_did = value.did, .duration_seconds = value.duration };
    }
    return entries;
}

/// Shared surfaces can't vary by listener, so radio is stricter than discovery:
/// public only (no supporter or owner gates, no gated audio space), on top of
/// discovery's exclusions (adult audio, copyright, takedowns, unavailable
/// accounts, audio not yet copied).
const radio_policy = composed.discovery_policy ++
    \\  AND COALESCE(pol.visibility, 'public') = 'public'
    \\  AND v.support_gate_type IS NULL
    \\  AND pol.space_uri IS NULL
    \\  AND v.audio_space IS NULL
    \\  AND v.record_created_at_us IS NOT NULL
;

// $1 track collection, $2 like collection, $3 the default hidden tags
const corpus_query =
    \\SELECT v.record_uri, v.owner_did, a.handle,
    \\  COALESCE(v.duration_seconds, 0)::bigint,
    \\  v.record_created_at_us,
    \\  COALESCE(metrics.play_count, 0)::bigint,
    \\  COALESCE(likes.like_count, 0)::bigint,
    \\  (
    \\    EXISTS (
    \\      SELECT 1 FROM plyr_index.track_tag_records AS tags
    \\      WHERE tags.record_uri = v.record_uri AND tags.record_cid = v.record_cid
    \\        AND tags.tags_present AND tags.tags && plyr_index.normalize_track_tags($3::text[])
    \\    ) OR EXISTS (
    \\      SELECT 1 FROM plyr_index.legacy_track_tags AS annotation
    \\      JOIN plyr_index.track_tag_records AS observed
    \\        ON observed.record_uri = annotation.record_uri
    \\        AND observed.record_cid = annotation.observed_record_cid AND NOT observed.tags_present
    \\      WHERE annotation.record_uri = v.record_uri AND annotation.observed_record_cid = v.record_cid
    \\        AND annotation.tag = ANY(plyr_index.normalize_track_tags($3::text[]))
    \\    ) OR EXISTS (
    \\      SELECT 1 FROM plyr_index.account_label_policies AS labels
    \\      WHERE labels.owner_did = v.owner_did AND labels.operator_labels ?| $3::text[]
    \\        AND (labels.expires_at_us IS NULL
    \\          OR labels.expires_at_us > (extract(epoch FROM statement_timestamp()) * 1000000)::bigint)
    \\    )
    \\  ) AS hidden
++ "\n" ++ composed.page_from ++ "\n" ++
    \\LEFT JOIN plyr_index.track_metrics AS metrics ON metrics.record_uri = v.record_uri
    \\LEFT JOIN plyr_index.track_like_counts AS likes
    \\  ON likes.collection = $2 AND likes.subject_uri = v.record_uri AND likes.subject_cid = v.record_cid
    \\WHERE TRUE
++ "\n" ++ radio_policy ++ "\n" ++
    \\ORDER BY v.record_created_at_us DESC, v.record_uri DESC
;

// $1 track collection, $2 profile collection, $3 like collection, $4 uris
const tracks_query = "SELECT\n" ++ composed.projected_columns ++ ",\n" ++ track_tag_sql.detail_tags ++ "\n" ++
    composed.projected_from ++ "\n" ++
    \\WHERE v.record_uri = ANY($4::text[])
++ "\n" ++ radio_policy;

const prune_sql =
    \\DELETE FROM plyr_playback.radio_rotations WHERE station = $1 AND period < $2
;

const pin_sql =
    \\INSERT INTO plyr_playback.radio_rotations (station, size, period, entries)
    \\VALUES ($1, $2, $3, $4::jsonb)
    \\ON CONFLICT (station, size, period) DO NOTHING
;

const peek_sql =
    \\SELECT entries::text, anchor_us FROM plyr_playback.radio_rotations
    \\WHERE station = $1 AND size = $2 AND period = $3
;

const anchor_sql =
    \\WITH pinned AS (
    \\  UPDATE plyr_playback.radio_rotations SET anchor_us = $4
    \\  WHERE station = $1 AND size = $2 AND period = $3 AND anchor_us IS NULL
    \\  RETURNING anchor_us
    \\)
    \\SELECT anchor_us FROM pinned
    \\UNION ALL
    \\SELECT anchor_us FROM plyr_playback.radio_rotations
    \\WHERE station = $1 AND size = $2 AND period = $3 AND anchor_us IS NOT NULL
    \\  AND NOT EXISTS (SELECT 1 FROM pinned)
;

test "a pinned rotation round-trips through its stored form" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const entries = [_]Entry{
        .{ .uri = "at://did:plc:a/fm.plyr.track/1", .owner_did = "did:plc:a", .duration_seconds = 200 },
        .{ .uri = "at://did:plc:b/fm.plyr.track/2", .owner_did = "did:plc:b", .duration_seconds = 31 },
    };
    const decoded = try decodeEntries(a, try encodeEntries(a, &entries));
    try std.testing.expectEqual(@as(usize, 2), decoded.len);
    try std.testing.expectEqualStrings(entries[1].uri, decoded[1].uri);
    try std.testing.expectEqual(@as(i64, 31), decoded[1].duration_seconds);
    try std.testing.expectError(error.CorruptRotation, decodeEntries(a, "[{\"uri\":\"x\",\"did\":\"y\",\"duration\":0}]"));
}
