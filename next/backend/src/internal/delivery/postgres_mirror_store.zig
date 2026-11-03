//! Work queue and results for the blob mirror, straight off the projection.
//!
//! A candidate is a live, available track record whose audio blob has no
//! verified delivery origin for its current record CID and is not backing off
//! after a failure. A mirror result is only written while that record version
//! is still current, so a record edited mid-copy is simply picked up again.

const std = @import("std");
const pg = @import("pg");

pub const Candidate = struct {
    record_uri: []const u8,
    record_cid: []const u8,
    owner_did: []const u8,
    blob_cid: []const u8,
    media_type: []const u8,
    byte_length: ?i64,
};

pub const Error = error{ StoreUnavailable, CorruptProjection, OutOfMemory };

pub const PostgresMirrorStore = struct {
    pool: *pg.Pool,

    /// Allocations belong to `allocator` (use an arena per batch).
    pub fn candidates(
        self: PostgresMirrorStore,
        allocator: std.mem.Allocator,
        now_us: i64,
        limit: u32,
    ) Error![]Candidate {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        var result = conn.query(candidate_query, .{ now_us, @as(i64, limit) }) catch |err| {
            logError(conn, "mirror candidate query failed", err);
            return error.StoreUnavailable;
        };
        defer result.deinit();
        var items: std.ArrayList(Candidate) = .empty;
        while (result.next() catch return error.StoreUnavailable) |row| {
            items.append(allocator, .{
                .record_uri = try dupe(allocator, row.get([]const u8, 0)),
                .record_cid = try dupe(allocator, row.get([]const u8, 1)),
                .owner_did = try dupe(allocator, row.get([]const u8, 2)),
                .blob_cid = try dupe(allocator, row.get([]const u8, 3)),
                .media_type = try dupe(allocator, row.get([]const u8, 4)),
                .byte_length = row.get(?i64, 5) catch return error.CorruptProjection,
            }) catch return error.OutOfMemory;
        }
        return items.toOwnedSlice(allocator) catch error.OutOfMemory;
    }

    /// Returns false when the record moved on (edited/deleted) during the copy.
    pub fn recordMirrored(
        self: PostgresMirrorStore,
        candidate: Candidate,
        origin_url: []const u8,
        now_us: i64,
    ) Error!bool {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        const inserted = conn.exec(record_query, .{
            candidate.record_uri,
            candidate.record_cid,
            origin_url,
            candidate.media_type,
            candidate.blob_cid,
            now_us,
        }) catch |err| {
            logError(conn, "mirror origin write failed", err);
            return error.StoreUnavailable;
        };
        _ = conn.exec(
            "DELETE FROM plyr_index.track_mirror_attempts WHERE record_uri = $1",
            .{candidate.record_uri},
        ) catch |err| {
            logError(conn, "mirror attempt cleanup failed", err);
            return error.StoreUnavailable;
        };
        return (inserted orelse 0) == 1;
    }

    pub fn recordFailure(
        self: PostgresMirrorStore,
        candidate: Candidate,
        reason: []const u8,
        now_us: i64,
    ) Error!void {
        const conn = self.pool.acquire() catch return error.StoreUnavailable;
        defer self.pool.release(conn);
        _ = conn.exec(failure_query, .{
            candidate.record_uri,
            candidate.record_cid,
            reason[0..@min(reason.len, 255)],
            now_us,
        }) catch |err| {
            logError(conn, "mirror failure write failed", err);
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

/// Track versions the mirror still has to copy, whether or not a retry is
/// due; shared with the backlog count in /v1/health/ingest.
pub const pending_from =
    \\FROM plyr_index.track_records AS v
    \\JOIN plyr_index.account_availability AS aa
    \\  ON aa.repo_did = v.owner_did AND aa.available
    \\LEFT JOIN plyr_index.track_delivery_origins AS d
    \\  ON d.record_uri = v.record_uri AND d.service = 'r2'
;

pub const pending_where =
    \\WHERE NOT v.deleted
    \\  AND v.record_cid IS NOT NULL
    \\  AND v.audio_blob_cid IS NOT NULL
    \\  AND v.audio_blob_media_type IS NOT NULL
    \\  -- a record that already names an https audio URL (e.g. prod's CDN)
    \\  -- plays from it; copying it again would double storage for no gain.
    \\  AND (v.audio_url IS NULL OR v.audio_url NOT LIKE 'https://%')
    \\  AND (d.record_uri IS NULL OR d.record_cid <> v.record_cid
    \\       OR d.artifact_cid <> v.audio_blob_cid)
;

const candidate_query =
    \\SELECT v.record_uri, v.record_cid, v.owner_did, v.audio_blob_cid,
    \\  v.audio_blob_media_type, v.audio_blob_size
++ "\n" ++ pending_from ++ "\n" ++
    \\LEFT JOIN plyr_index.track_mirror_attempts AS m
    \\  ON m.record_uri = v.record_uri AND m.record_cid = v.record_cid
++ "\n" ++ pending_where ++ "\n" ++
    \\  AND (m.record_uri IS NULL OR m.next_attempt_us <= $1)
    \\ORDER BY m.attempts NULLS FIRST, v.record_uri
    \\LIMIT $2
;

// Writes only while the mirrored record version is still the current one.
const record_query =
    \\INSERT INTO plyr_index.track_delivery_origins (
    \\  record_uri, service, record_cid, origin_url, media_type, artifact_cid,
    \\  verification, observed_at_us
    \\)
    \\SELECT $1, 'r2', $2, $3, $4, $5, 'verified_blob_cid', $6
    \\FROM plyr_index.track_records AS v
    \\WHERE v.record_uri = $1 AND v.record_cid = $2 AND NOT v.deleted
    \\  AND v.audio_blob_cid = $5
    \\ON CONFLICT (record_uri, service) DO UPDATE SET
    \\  record_cid = EXCLUDED.record_cid,
    \\  origin_url = EXCLUDED.origin_url,
    \\  media_type = EXCLUDED.media_type,
    \\  artifact_cid = EXCLUDED.artifact_cid,
    \\  verification = EXCLUDED.verification,
    \\  observed_at_us = EXCLUDED.observed_at_us
;

// Exponential backoff from one minute, capped at a day; a new record version
// starts over.
const failure_query =
    \\INSERT INTO plyr_index.track_mirror_attempts (
    \\  record_uri, record_cid, attempts, next_attempt_us, last_error
    \\) VALUES ($1, $2, 1, $4 + 60000000, $3)
    \\ON CONFLICT (record_uri) DO UPDATE SET
    \\  record_cid = EXCLUDED.record_cid,
    \\  attempts = CASE WHEN track_mirror_attempts.record_cid = EXCLUDED.record_cid
    \\    THEN track_mirror_attempts.attempts + 1 ELSE 1 END,
    \\  next_attempt_us = $4 + LEAST(
    \\    86400000000,
    \\    60000000 * power(2, LEAST(16, CASE WHEN track_mirror_attempts.record_cid = EXCLUDED.record_cid
    \\      THEN track_mirror_attempts.attempts ELSE 0 END))::bigint
    \\  ),
    \\  last_error = EXCLUDED.last_error
;
