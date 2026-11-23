//! Work queue and results for the waveform prober, straight off the projection.
//!
//! A candidate is a live, public track version with no levels for its current
//! CID, unless an earlier attempt is still backing off. New tracks go first,
//! so an upload gets its levels before the backfill reaches older ones. Levels
//! only land while that version is still current, so a record edited
//! mid-probe is simply picked up again.

const std = @import("std");
const pg = @import("pg");

pub const Candidate = struct {
    record_uri: []const u8,
    record_cid: []const u8,
    /// the mirrored copy when there is one, else the record's https audioUrl
    audio_url: []const u8,
};

pub const Waveform = struct {
    fps: u8,
    bands: u8,
    levels: []const u8,
};

pub const Error = error{ StoreUnavailable, CorruptProjection, OutOfMemory };

pub const PostgresWaveformStore = struct {
    pool: *pg.Pool,

    /// Allocations belong to `allocator` (use an arena per batch).
    pub fn candidates(self: PostgresWaveformStore, allocator: std.mem.Allocator, now_us: i64, limit: u32) Error![]Candidate {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        var result = conn.query(candidate_query, .{ now_us, @as(i64, limit) }) catch |err| {
            logError(conn, "waveform candidate query failed", err);
            return error.StoreUnavailable;
        };
        defer result.deinit();
        var items: std.ArrayList(Candidate) = .empty;
        while (result.next() catch return error.StoreUnavailable) |row| {
            items.append(allocator, .{
                .record_uri = try dupe(allocator, row.get([]const u8, 0)),
                .record_cid = try dupe(allocator, row.get([]const u8, 1)),
                .audio_url = try dupe(allocator, row.get([]const u8, 2)),
            }) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch error.OutOfMemory;
    }

    /// Returns false when the record moved on (edited/deleted) during the probe.
    pub fn recordMeasured(self: PostgresWaveformStore, candidate: Candidate, waveform: Waveform, now_us: i64) Error!bool {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        const written = conn.exec(measured_query, .{
            candidate.record_uri,
            candidate.record_cid,
            @as(i16, waveform.fps),
            @as(i16, waveform.bands),
            waveform.levels,
            now_us,
        }) catch |err| {
            logError(conn, "waveform write failed", err);
            return error.StoreUnavailable;
        };
        return (written orelse 0) == 1;
    }

    pub fn recordFailure(self: PostgresWaveformStore, candidate: Candidate, reason: []const u8, now_us: i64) Error!void {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        _ = conn.exec(failure_query, .{
            candidate.record_uri,
            candidate.record_cid,
            reason[0..@min(reason.len, 255)],
            now_us,
        }) catch |err| {
            logError(conn, "waveform failure write failed", err);
            return error.StoreUnavailable;
        };
    }

    /// The levels measured for the track's current version, if any. The
    /// result and its CID belong to `allocator`.
    pub fn get(self: PostgresWaveformStore, allocator: std.mem.Allocator, record_uri: []const u8) Error!?struct { cid: []const u8, waveform: Waveform } {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        var row = (conn.row(get_query, .{record_uri}) catch |err| {
            logError(conn, "waveform read failed", err);
            return error.StoreUnavailable;
        }) orelse return null;
        defer row.deinit() catch {};
        const fps = row.get(i16, 1) catch return error.CorruptProjection;
        const bands = row.get(i16, 2) catch return error.CorruptProjection;
        return .{
            .cid = try dupe(allocator, row.get([]const u8, 0)),
            .waveform = .{
                .fps = std.math.cast(u8, fps) orelse return error.CorruptProjection,
                .bands = std.math.cast(u8, bands) orelse return error.CorruptProjection,
                .levels = try dupe(allocator, row.get([]const u8, 3)),
            },
        };
    }
};

fn dupe(allocator: std.mem.Allocator, value: anyerror![]const u8) Error![]const u8 {
    const text = value catch return error.CorruptProjection;
    return allocator.dupe(u8, text) catch error.OutOfMemory;
}

fn logError(conn: *pg.Conn, message: []const u8, err: anyerror) void {
    if (conn.err) |pg_err|
        std.log.err("{s}: {}: {s}", .{ message, err, pg_err.message })
    else
        std.log.err("{s}: {}", .{ message, err });
}

// Private (space) audio is never fetched: only versions that play from a
// public URL, the mirrored copy first.
const candidate_query =
    \\SELECT v.record_uri, v.record_cid, COALESCE(d.origin_url, v.audio_url)
    \\FROM plyr_index.track_records AS v
    \\JOIN plyr_index.account_availability AS aa
    \\  ON aa.repo_did = v.owner_did AND aa.available
    \\LEFT JOIN plyr_index.track_delivery_origins AS d
    \\  ON d.record_uri = v.record_uri AND d.artifact_cid = v.audio_blob_cid
    \\  AND d.service = 'r2' AND d.verification = 'verified_blob_cid'
    \\LEFT JOIN plyr_index.track_waveforms AS w
    \\  ON w.record_uri = v.record_uri
    \\WHERE NOT v.deleted
    \\  AND v.record_cid IS NOT NULL
    \\  AND v.audio_space IS NULL
    \\  AND COALESCE(d.origin_url, v.audio_url) LIKE 'https://%'
    \\  -- production's gated audio answers only its signed-in supporters
    \\  AND COALESCE(d.origin_url, v.audio_url) NOT LIKE 'https://api.plyr.fm/%'
    \\  AND (w.record_uri IS NULL OR w.record_cid <> v.record_cid
    \\    OR (w.levels IS NULL AND w.next_attempt_us <= $1))
    \\ORDER BY (w.record_uri IS NOT NULL AND w.record_cid = v.record_cid), v.indexed_at_us DESC, v.record_uri
    \\LIMIT $2
;

// Writes only while the measured record version is still the current one.
const measured_query =
    \\INSERT INTO plyr_index.track_waveforms (
    \\  record_uri, record_cid, fps, bands, levels, attempts, next_attempt_us, last_error, observed_at_us
    \\)
    \\SELECT $1, $2, $3, $4, $5, 0, 0, NULL, $6
    \\FROM plyr_index.track_records AS v
    \\WHERE v.record_uri = $1 AND v.record_cid = $2 AND NOT v.deleted
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  record_cid = EXCLUDED.record_cid,
    \\  fps = EXCLUDED.fps,
    \\  bands = EXCLUDED.bands,
    \\  levels = EXCLUDED.levels,
    \\  attempts = 0,
    \\  next_attempt_us = 0,
    \\  last_error = NULL,
    \\  observed_at_us = EXCLUDED.observed_at_us
;

// Exponential backoff from ten minutes, capped at a week; a new record
// version starts over.
const failure_query =
    \\INSERT INTO plyr_index.track_waveforms (
    \\  record_uri, record_cid, fps, bands, levels, attempts, next_attempt_us, last_error, observed_at_us
    \\) VALUES ($1, $2, NULL, NULL, NULL, 1, $4::bigint + 600000000, $3, $4)
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  record_cid = EXCLUDED.record_cid,
    \\  fps = NULL,
    \\  bands = NULL,
    \\  levels = NULL,
    \\  attempts = CASE WHEN track_waveforms.record_cid = EXCLUDED.record_cid
    \\    THEN track_waveforms.attempts + 1 ELSE 1 END,
    \\  next_attempt_us = $4::bigint + LEAST(
    \\    604800000000,
    \\    600000000 * power(2, LEAST(16, CASE WHEN track_waveforms.record_cid = EXCLUDED.record_cid
    \\      THEN track_waveforms.attempts ELSE 0 END))::bigint
    \\  ),
    \\  last_error = EXCLUDED.last_error,
    \\  observed_at_us = EXCLUDED.observed_at_us
;

// Only levels measured for the version the projection holds now.
const get_query =
    \\SELECT w.record_cid, w.fps, w.bands, w.levels
    \\FROM plyr_index.track_waveforms AS w
    \\JOIN plyr_index.track_records AS v
    \\  ON v.record_uri = w.record_uri AND v.record_cid = w.record_cid AND NOT v.deleted
    \\WHERE w.record_uri = $1 AND w.levels IS NOT NULL
;

test "the prober measures new tracks first, backs off, and starts over for a new version" {
    const postgres_test_lock = @import("../testing/postgres_lock.zig");
    const mirror_store = @import("postgres_mirror_store.zig");
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    var pool = try pg.Pool.initUri(io, allocator, try std.Uri.parse(std.mem.span(url_z)), .{ .size = 1 });
    defer pool.deinit();
    var name = (try pool.row("SELECT current_database()", .{})).?;
    const safe = std.mem.eql(u8, try name.get([]const u8, 0), "zig_test");
    try name.deinit();
    if (!safe) return error.UnsafeTestDatabase;
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.account_availability (repo_did text PRIMARY KEY, available boolean NOT NULL)", .{});
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.track_records (
        \\  record_uri text PRIMARY KEY, record_cid text, owner_did text NOT NULL,
        \\  audio_url text, audio_blob_cid text, audio_space text,
        \\  deleted boolean NOT NULL DEFAULT false, indexed_at_us bigint NOT NULL DEFAULT 0
        \\)
    , .{});
    try mirror_store.createTestTables(pool);
    _ = try pool.exec(@embedFile("migration_0062_track_waveforms"), .{});
    _ = try pool.exec("INSERT INTO plyr_index.account_availability VALUES ('did:plc:a', true), ('did:plc:gone', false)", .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.track_records (record_uri, record_cid, owner_did, audio_url, audio_blob_cid, audio_space, indexed_at_us) VALUES
        \\('at://a/old', 'cido', 'did:plc:a', 'https://audio.example/o.mp3', NULL, NULL, 1),
        \\('at://a/new', 'cidn', 'did:plc:a', 'https://audio.example/n.mp3', NULL, NULL, 9),
        \\('at://a/private', 'cidp', 'did:plc:a', NULL, 'bafyblob', 'at://space', 5),
        \\('at://a/insecure', 'cidi', 'did:plc:a', 'http://audio.example/i.mp3', NULL, NULL, 5),
        \\('at://a/gated', 'cidgt', 'did:plc:a', 'https://api.plyr.fm/audio/abc123', NULL, NULL, 5),
        \\('at://a/blob', 'cidb', 'did:plc:a', NULL, 'bafyblob2', NULL, 3),
        \\('at://gone/1', 'cidg', 'did:plc:gone', 'https://audio.example/g.mp3', NULL, NULL, 5)
    , .{});
    _ = try pool.exec("INSERT INTO plyr_index.track_delivery_origins VALUES ('at://a/blob', 'r2', 'cidb', 'https://cdn.example/audio/bafyblob2', 'audio/mpeg', 'bafyblob2', 'verified_blob_cid', 1)", .{});

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const store: PostgresWaveformStore = .{ .pool = pool };

    const first = try store.candidates(arena, 1000, 10);
    try std.testing.expectEqual(@as(usize, 3), first.len);
    try std.testing.expectEqualStrings("at://a/new", first[0].record_uri);
    try std.testing.expectEqualStrings("at://a/blob", first[1].record_uri);
    try std.testing.expectEqualStrings("https://cdn.example/audio/bafyblob2", first[1].audio_url);
    try std.testing.expectEqualStrings("at://a/old", first[2].record_uri);

    try std.testing.expect(try store.recordMeasured(first[0], .{ .fps = 20, .bands = 4, .levels = &.{ 1, 2, 3, 4 } }, 1000));
    try store.recordFailure(first[1], "AudioUnavailable", 1000);
    const read = (try store.get(arena, "at://a/new")).?;
    try std.testing.expectEqualStrings("cidn", read.cid);
    try std.testing.expectEqualSlices(u8, &.{ 1, 2, 3, 4 }, read.waveform.levels);
    try std.testing.expect((try store.get(arena, "at://a/blob")) == null);

    // measured and backing-off versions wait; the rest come round again
    const second = try store.candidates(arena, 2000, 10);
    try std.testing.expectEqual(@as(usize, 1), second.len);
    try std.testing.expectEqualStrings("at://a/old", second[0].record_uri);
    const later = try store.candidates(arena, 1000 + 600000000, 10);
    try std.testing.expectEqual(@as(usize, 2), later.len);

    // an edit makes the old levels stale: not served, measured again
    _ = try pool.exec("UPDATE plyr_index.track_records SET record_cid = 'cidn2' WHERE record_uri = 'at://a/new'", .{});
    try std.testing.expect((try store.get(arena, "at://a/new")) == null);
    try std.testing.expect(!(try store.recordMeasured(first[0], .{ .fps = 20, .bands = 4, .levels = &.{ 1, 2, 3, 4 } }, 3000)));
    const edited = try store.candidates(arena, 3000, 10);
    try std.testing.expectEqualStrings("at://a/new", edited[0].record_uri);
}
