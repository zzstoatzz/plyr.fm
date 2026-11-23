//! Work queue and results for the duration prober, straight off the projection.
//!
//! A candidate is a live, public track version whose record names no duration
//! and that has no measurement for its current CID, unless an earlier attempt
//! is still backing off. A measurement only lands while that version is still
//! current, so a record edited mid-probe is simply picked up again.

const std = @import("std");
const pg = @import("pg");

pub const Candidate = struct {
    record_uri: []const u8,
    record_cid: []const u8,
    /// the mirrored copy when there is one, else the record's https audioUrl
    audio_url: []const u8,
};

pub const Error = error{ StoreUnavailable, CorruptProjection, OutOfMemory };

/// The running time reads use for track alias `t`: the record's own, else the
/// prober's measurement of that same record version.
pub fn effectiveDuration(comptime t: []const u8) []const u8 {
    return "COALESCE(" ++ t ++ ".duration_seconds, (SELECT measured.duration_seconds" ++
        " FROM plyr_index.track_measured_durations AS measured" ++
        " WHERE measured.record_uri = " ++ t ++ ".record_uri AND measured.record_cid = " ++ t ++ ".record_cid))";
}

pub const PostgresDurationStore = struct {
    pool: *pg.Pool,

    /// Allocations belong to `allocator` (use an arena per batch).
    pub fn candidates(self: PostgresDurationStore, allocator: std.mem.Allocator, now_us: i64, limit: u32) Error![]Candidate {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        var result = conn.query(candidate_query, .{ now_us, @as(i64, limit) }) catch |err| {
            logError(conn, "duration candidate query failed", err);
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
    pub fn recordMeasured(self: PostgresDurationStore, candidate: Candidate, seconds: u64, now_us: i64) Error!bool {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        const written = conn.exec(measured_query, .{
            candidate.record_uri,
            candidate.record_cid,
            std.math.cast(i64, seconds) orelse return error.CorruptProjection,
            now_us,
        }) catch |err| {
            logError(conn, "duration write failed", err);
            return error.StoreUnavailable;
        };
        return (written orelse 0) == 1;
    }

    pub fn recordFailure(self: PostgresDurationStore, candidate: Candidate, reason: []const u8, now_us: i64) Error!void {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        _ = conn.exec(failure_query, .{
            candidate.record_uri,
            candidate.record_cid,
            reason[0..@min(reason.len, 255)],
            now_us,
        }) catch |err| {
            logError(conn, "duration failure write failed", err);
            return error.StoreUnavailable;
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
    \\LEFT JOIN plyr_index.track_measured_durations AS m
    \\  ON m.record_uri = v.record_uri
    \\WHERE NOT v.deleted
    \\  AND v.duration_seconds IS NULL
    \\  AND v.record_cid IS NOT NULL
    \\  AND v.audio_space IS NULL
    \\  AND COALESCE(d.origin_url, v.audio_url) LIKE 'https://%'
    \\  AND (m.record_uri IS NULL OR m.record_cid <> v.record_cid
    \\    OR (m.duration_seconds IS NULL AND m.next_attempt_us <= $1))
    \\ORDER BY m.attempts NULLS FIRST, v.record_uri
    \\LIMIT $2
;

// Writes only while the measured record version is still the current one.
const measured_query =
    \\INSERT INTO plyr_index.track_measured_durations (
    \\  record_uri, record_cid, duration_seconds, attempts, next_attempt_us, last_error, observed_at_us
    \\)
    \\SELECT $1, $2, $3, 0, 0, NULL, $4
    \\FROM plyr_index.track_records AS v
    \\WHERE v.record_uri = $1 AND v.record_cid = $2 AND NOT v.deleted
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  record_cid = EXCLUDED.record_cid,
    \\  duration_seconds = EXCLUDED.duration_seconds,
    \\  attempts = 0,
    \\  next_attempt_us = 0,
    \\  last_error = NULL,
    \\  observed_at_us = EXCLUDED.observed_at_us
;

// Exponential backoff from ten minutes, capped at a week; a new record
// version starts over.
const failure_query =
    \\INSERT INTO plyr_index.track_measured_durations (
    \\  record_uri, record_cid, duration_seconds, attempts, next_attempt_us, last_error, observed_at_us
    \\) VALUES ($1, $2, NULL, 1, $4::bigint + 600000000, $3, $4)
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  record_cid = EXCLUDED.record_cid,
    \\  duration_seconds = NULL,
    \\  attempts = CASE WHEN track_measured_durations.record_cid = EXCLUDED.record_cid
    \\    THEN track_measured_durations.attempts + 1 ELSE 1 END,
    \\  next_attempt_us = $4::bigint + LEAST(
    \\    604800000000,
    \\    600000000 * power(2, LEAST(16, CASE WHEN track_measured_durations.record_cid = EXCLUDED.record_cid
    \\      THEN track_measured_durations.attempts ELSE 0 END))::bigint
    \\  ),
    \\  last_error = EXCLUDED.last_error,
    \\  observed_at_us = EXCLUDED.observed_at_us
;

/// The measured-duration table, for tests whose queries read a track's running time.
pub fn createTestTable(pool: *pg.Pool) !void {
    _ = try pool.exec(@embedFile("migration_0055_measured_durations"), .{});
}

test "the prober measures, backs off, and starts over for a new version" {
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
        \\  duration_seconds bigint, audio_url text, audio_blob_cid text, audio_space text,
        \\  deleted boolean NOT NULL DEFAULT false
        \\)
    , .{});
    try mirror_store.createTestTables(pool);
    _ = try pool.exec("INSERT INTO plyr_index.account_availability VALUES ('did:plc:a', true), ('did:plc:gone', false)", .{});
    _ = try pool.exec(
        \\INSERT INTO plyr_index.track_records (record_uri, record_cid, owner_did, duration_seconds, audio_url, audio_blob_cid, audio_space) VALUES
        \\('at://a/1', 'cid1', 'did:plc:a', NULL, 'https://audio.example/1.mp3', NULL, NULL),
        \\('at://a/known', 'cidk', 'did:plc:a', 200, 'https://audio.example/k.mp3', NULL, NULL),
        \\('at://a/private', 'cidp', 'did:plc:a', NULL, NULL, 'bafyblob', 'at://space'),
        \\('at://a/insecure', 'cidi', 'did:plc:a', NULL, 'http://audio.example/i.mp3', NULL, NULL),
        \\('at://a/blob', 'cidb', 'did:plc:a', NULL, NULL, 'bafyblob2', NULL),
        \\('at://gone/1', 'cidg', 'did:plc:gone', NULL, 'https://audio.example/g.mp3', NULL, NULL)
    , .{});
    _ = try pool.exec("INSERT INTO plyr_index.track_delivery_origins VALUES ('at://a/blob', 'r2', 'cidb', 'https://cdn.example/audio/bafyblob2', 'audio/mpeg', 'bafyblob2', 'verified_blob_cid', 1)", .{});
    const store: PostgresDurationStore = .{ .pool = pool };

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const first = try store.candidates(arena.allocator(), 1_000, 10);
    try std.testing.expectEqual(@as(usize, 2), first.len);
    try std.testing.expectEqualStrings("at://a/1", first[0].record_uri);
    try std.testing.expectEqualStrings("https://audio.example/1.mp3", first[0].audio_url);
    try std.testing.expectEqualStrings("at://a/blob", first[1].record_uri);
    try std.testing.expectEqualStrings("https://cdn.example/audio/bafyblob2", first[1].audio_url);

    try std.testing.expect(try store.recordMeasured(first[0], 3766, 2_000));
    try store.recordFailure(first[1], "Unsupported", 2_000);
    try std.testing.expectEqual(@as(usize, 0), (try store.candidates(arena.allocator(), 3_000, 10)).len);
    // the failure comes due after its backoff
    const retry = try store.candidates(arena.allocator(), 2_000 + 600_000_000, 10);
    try std.testing.expectEqual(@as(usize, 1), retry.len);
    try std.testing.expectEqualStrings("at://a/blob", retry[0].record_uri);

    var read = (try pool.row("SELECT " ++ comptime effectiveDuration("v") ++ " FROM plyr_index.track_records AS v WHERE v.record_uri = 'at://a/1'", .{})).?;
    try std.testing.expectEqual(@as(?i64, 3766), try read.get(?i64, 0));
    try read.deinit();

    // an edit makes the measurement stale: reads drop it and the prober measures again
    _ = try pool.exec("UPDATE plyr_index.track_records SET record_cid = 'cid1b' WHERE record_uri = 'at://a/1'", .{});
    var stale = (try pool.row("SELECT " ++ comptime effectiveDuration("v") ++ " FROM plyr_index.track_records AS v WHERE v.record_uri = 'at://a/1'", .{})).?;
    try std.testing.expectEqual(@as(?i64, null), try stale.get(?i64, 0));
    try stale.deinit();
    const again = try store.candidates(arena.allocator(), 3_000, 10);
    try std.testing.expectEqual(@as(usize, 1), again.len);
    try std.testing.expectEqualStrings("cid1b", again[0].record_cid);
    // a measurement for a version that has since moved on is dropped
    try std.testing.expect(!try store.recordMeasured(first[0], 1, 4_000));
    // a real clock reads in the quadrillions of microseconds, past int4
    try store.recordFailure(again[0], "Unsupported", 1_795_000_000_000_000);
}
