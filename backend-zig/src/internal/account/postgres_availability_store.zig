//! PostgreSQL adapter for canonical account-availability evidence.

const std = @import("std");
const pg = @import("pg");
const zat = @import("zat");
const availability = @import("availability.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");

pub const PostgresAvailabilityStore = struct {
    pool: *pg.Pool,

    pub fn store(self: *PostgresAvailabilityStore) availability.Store {
        return .{ .context = self, .apply_fn = applyOpaque };
    }

    fn applyOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        evidence: availability.Evidence,
    ) availability.Error!availability.ApplyResult {
        const self: *PostgresAvailabilityStore = @ptrCast(@alignCast(context));
        const conn = self.pool.acquire() catch return error.ProjectionUnavailable;
        defer self.pool.release(conn);
        return self.applyInTransaction(conn, allocator, evidence);
    }

    pub fn applyInTransaction(
        _: *PostgresAvailabilityStore,
        conn: *pg.Conn,
        allocator: std.mem.Allocator,
        evidence: availability.Evidence,
    ) availability.Error!availability.ApplyResult {
        try evidence.validate();
        const commit_cid: ?[]const u8 = if (evidence.commit_cid) |cid|
            cid.toString(allocator) catch return error.OutOfMemory
        else
            null;
        defer if (commit_cid) |value| allocator.free(value);
        const reason: ?[]const u8 = if (evidence.reason) |value| @tagName(value) else null;
        const affected = conn.exec(upsert_sql, .{
            evidence.repo_did,
            evidence.available,
            reason,
            @tagName(evidence.source),
            evidence.repository_rev,
            commit_cid,
            evidence.pds_origin,
            evidence.observed_at_us,
        }) catch |err| {
            std.log.err("account availability upsert failed: {}", .{err});
            return error.ProjectionUnavailable;
        };
        if (affected == 1) return .applied;
        if (affected != 0) return error.CorruptProjection;
        return classifyReplay(conn, evidence, commit_cid, reason);
    }
};

fn classifyReplay(
    conn: *pg.Conn,
    evidence: availability.Evidence,
    commit_cid: ?[]const u8,
    reason: ?[]const u8,
) availability.Error!availability.ApplyResult {
    var row = (conn.row(classify_sql, .{evidence.repo_did}) catch
        return error.ProjectionUnavailable) orelse return error.CorruptProjection;
    defer row.deinit() catch {};
    const observed_at_us = row.get(i64, 0) catch return error.CorruptProjection;
    if (observed_at_us > evidence.observed_at_us) return .stale;
    if (observed_at_us < evidence.observed_at_us) return error.CorruptProjection;
    const current_available = row.get(bool, 1) catch return error.CorruptProjection;
    const current_reason = row.get(?[]const u8, 2) catch return error.CorruptProjection;
    const current_source = row.get([]const u8, 3) catch return error.CorruptProjection;
    const current_rev = row.get(?[]const u8, 4) catch return error.CorruptProjection;
    const current_commit = row.get(?[]const u8, 5) catch return error.CorruptProjection;
    const current_pds = row.get(?[]const u8, 6) catch return error.CorruptProjection;
    if (current_available != evidence.available or
        !optionalEql(current_reason, reason) or
        !std.mem.eql(u8, current_source, @tagName(evidence.source)) or
        !optionalEql(current_rev, evidence.repository_rev) or
        !optionalEql(current_commit, commit_cid) or
        !optionalEql(current_pds, evidence.pds_origin))
        return error.EvidenceConflict;
    return .idempotent;
}

fn optionalEql(left: ?[]const u8, right: ?[]const u8) bool {
    if (left == null or right == null) return left == null and right == null;
    return std.mem.eql(u8, left.?, right.?);
}

const upsert_sql =
    \\INSERT INTO plyr_index.account_availability (
    \\  repo_did, available, unavailable_reason, evidence_source,
    \\  repository_rev, commit_cid, pds_origin, observed_at_us
    \\) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    \\ON CONFLICT (repo_did) DO UPDATE SET
    \\  available = EXCLUDED.available,
    \\  unavailable_reason = EXCLUDED.unavailable_reason,
    \\  evidence_source = EXCLUDED.evidence_source,
    \\  repository_rev = EXCLUDED.repository_rev,
    \\  commit_cid = EXCLUDED.commit_cid,
    \\  pds_origin = EXCLUDED.pds_origin,
    \\  observed_at_us = EXCLUDED.observed_at_us
    \\WHERE plyr_index.account_availability.observed_at_us < EXCLUDED.observed_at_us
;

const classify_sql =
    \\SELECT observed_at_us, available, unavailable_reason, evidence_source,
    \\  repository_rev, commit_cid, pds_origin
    \\FROM plyr_index.account_availability WHERE repo_did = $1
;

pub fn createTestTable(pool: *pg.Pool) !void {
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.account_availability (
        \\  repo_did text PRIMARY KEY,
        \\  available boolean NOT NULL,
        \\  unavailable_reason text,
        \\  evidence_source text NOT NULL,
        \\  repository_rev text,
        \\  commit_cid text,
        \\  pds_origin text,
        \\  observed_at_us bigint NOT NULL CHECK (observed_at_us >= 0),
        \\  CHECK (available = (unavailable_reason IS NULL)),
        \\  CHECK (evidence_source IN ('verified_repository', 'current_pds')),
        \\  CHECK (unavailable_reason IS NULL OR unavailable_reason IN
        \\    ('deactivated', 'deleted', 'takendown', 'suspended')),
        \\  CHECK ((evidence_source = 'verified_repository' AND available
        \\    AND repository_rev IS NOT NULL AND commit_cid IS NOT NULL AND pds_origin IS NULL)
        \\    OR (evidence_source = 'current_pds' AND commit_cid IS NULL
        \\    AND pds_origin IS NOT NULL))
        \\)
    , .{});
}

test "PostgreSQL availability is monotonic, replay safe, and source explicit" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 1 });
    defer pool.deinit();
    try requireDisposableDatabase(pool, allocator);
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    try createTestTable(pool);

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const commit = try zat.Cid.forDagCbor(arena.allocator(), "commit");
    var implementation: PostgresAvailabilityStore = .{ .pool = pool };
    const unavailable: availability.Evidence = .{
        .repo_did = "did:plc:artist",
        .available = false,
        .reason = .deactivated,
        .source = .current_pds,
        .pds_origin = "https://pds.example.com",
        .observed_at_us = 10,
    };
    try std.testing.expectEqual(availability.ApplyResult.applied, try implementation.store().apply(arena.allocator(), unavailable));
    try std.testing.expectEqual(availability.ApplyResult.idempotent, try implementation.store().apply(arena.allocator(), unavailable));
    const activity: availability.Evidence = .{
        .repo_did = "did:plc:artist",
        .available = true,
        .source = .verified_repository,
        .repository_rev = "3jqfcqzm3fo2j",
        .commit_cid = commit,
        .observed_at_us = 20,
    };
    try std.testing.expectEqual(availability.ApplyResult.applied, try implementation.store().apply(arena.allocator(), activity));
    try std.testing.expectEqual(availability.ApplyResult.stale, try implementation.store().apply(arena.allocator(), unavailable));
    var conflict = activity;
    conflict.pds_origin = "https://pds.example.com";
    try std.testing.expectError(error.InvalidEvidence, implementation.store().apply(arena.allocator(), conflict));
}

fn requireDisposableDatabase(pool: *pg.Pool, allocator: std.mem.Allocator) !void {
    var row = (try pool.row("SELECT current_database()", .{})) orelse return error.UnsafeTestDatabase;
    defer row.deinit() catch {};
    const database = try row.get([]const u8, 0);
    const owned = try allocator.dupe(u8, database);
    defer allocator.free(owned);
    if (!std.mem.eql(u8, owned, "relay_test")) return error.UnsafeTestDatabase;
}
