//! PostgreSQL claim/lease scheduler for current-PDS account checks.

const std = @import("std");
const pg = @import("pg");
const schedule_module = @import("check_schedule.zig");
const postgres_test_lock = @import("../testing/postgres_lock.zig");

pub const PostgresCheckSchedule = struct {
    pool: *pg.Pool,

    pub fn port(self: *PostgresCheckSchedule) schedule_module.Schedule {
        return .{
            .context = self,
            .seed_fn = seedOpaque,
            .hint_fn = hintOpaque,
            .claim_fn = claimOpaque,
            .complete_fn = completeOpaque,
        };
    }

    fn seedOpaque(context: *anyopaque, now_us: i64) schedule_module.Error!usize {
        const self: *PostgresCheckSchedule = @ptrCast(@alignCast(context));
        const affected = self.pool.exec(seed_sql, .{now_us}) catch |err| {
            std.log.err("account check schedule seed failed: {}", .{err});
            return error.ScheduleUnavailable;
        } orelse 0;
        return std.math.cast(usize, affected) orelse error.CorruptSchedule;
    }

    fn hintOpaque(
        context: *anyopaque,
        repo_did: []const u8,
        now_us: i64,
    ) schedule_module.Error!void {
        const self: *PostgresCheckSchedule = @ptrCast(@alignCast(context));
        const affected = self.pool.exec(hint_sql, .{ repo_did, now_us }) catch |err| {
            std.log.err("account check hint failed: {}", .{err});
            return error.ScheduleUnavailable;
        } orelse 0;
        if (affected > 1) return error.CorruptSchedule;
        // Unknown repositories are intentionally ignored; periodic seeding is
        // restricted to DIDs with an authenticated repository head.
    }

    fn claimOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        now_us: i64,
        lease_duration_us: i64,
    ) schedule_module.Error!?schedule_module.Claim {
        const self: *PostgresCheckSchedule = @ptrCast(@alignCast(context));
        const lease_until_us = std.math.add(i64, now_us, lease_duration_us) catch
            return error.InvalidTime;
        var row = self.pool.row(claim_sql, .{ now_us, lease_until_us }) catch |err| {
            std.log.err("account check claim failed: {}", .{err});
            return error.ScheduleUnavailable;
        } orelse return null;
        defer row.deinit() catch {};
        const repo_did = allocator.dupe(
            u8,
            row.get([]const u8, 0) catch return error.CorruptSchedule,
        ) catch return error.OutOfMemory;
        const claim: schedule_module.Claim = .{
            .repo_did = repo_did,
            .attempted_at_us = row.get(i64, 1) catch {
                allocator.free(repo_did);
                return error.CorruptSchedule;
            },
            .lease_until_us = row.get(i64, 2) catch {
                allocator.free(repo_did);
                return error.CorruptSchedule;
            },
            .hint_watermark_us = row.get(i64, 3) catch {
                allocator.free(repo_did);
                return error.CorruptSchedule;
            },
        };
        claim.validate() catch {
            allocator.free(repo_did);
            return error.CorruptSchedule;
        };
        return claim;
    }

    fn completeOpaque(
        context: *anyopaque,
        completion: schedule_module.Completion,
    ) schedule_module.Error!void {
        const self: *PostgresCheckSchedule = @ptrCast(@alignCast(context));
        const affected = self.pool.exec(complete_sql, .{
            completion.next_attempt_at_us,
            completion.completed_at_us,
            completion.successful_response,
            completion.authoritative,
            completion.outcome,
            completion.claim.repo_did,
            completion.claim.attempted_at_us,
            completion.claim.lease_until_us,
            completion.claim.hint_watermark_us,
        }) catch |err| {
            std.log.err("account check completion failed: {}", .{err});
            return error.ScheduleUnavailable;
        };
        if (affected == 0) return error.LostLease;
        if (affected != 1) return error.CorruptSchedule;
    }
};

const seed_sql =
    \\INSERT INTO plyr_index.account_status_checks (
    \\  repo_did, next_attempt_at_us, hinted_at_us, attempt_count,
    \\  consecutive_failures
    \\)
    \\SELECT repo_did, $1, $1, 0, 0 FROM plyr_index.repo_heads
    \\ON CONFLICT (repo_did) DO NOTHING
;

const hint_sql =
    \\INSERT INTO plyr_index.account_status_checks (
    \\  repo_did, next_attempt_at_us, hinted_at_us, attempt_count,
    \\  consecutive_failures
    \\)
    \\SELECT repo_did, $2, $2, 0, 0 FROM plyr_index.repo_heads WHERE repo_did = $1
    \\ON CONFLICT (repo_did) DO UPDATE SET
    \\  next_attempt_at_us = LEAST(
    \\    plyr_index.account_status_checks.next_attempt_at_us,
    \\    EXCLUDED.next_attempt_at_us
    \\  ),
    \\  hinted_at_us = GREATEST(
    \\    plyr_index.account_status_checks.hinted_at_us,
    \\    EXCLUDED.hinted_at_us
    \\  )
;

const claim_sql =
    \\WITH candidate AS (
    \\  SELECT repo_did FROM plyr_index.account_status_checks
    \\  WHERE next_attempt_at_us <= $1
    \\    AND (lease_until_us IS NULL OR lease_until_us <= $1)
    \\  ORDER BY next_attempt_at_us, repo_did
    \\  FOR UPDATE SKIP LOCKED
    \\  LIMIT 1
    \\)
    \\UPDATE plyr_index.account_status_checks AS checks SET
    \\  lease_until_us = $2,
    \\  last_attempt_at_us = $1,
    \\  attempt_count = checks.attempt_count + 1
    \\FROM candidate
    \\WHERE checks.repo_did = candidate.repo_did
    \\RETURNING checks.repo_did, checks.last_attempt_at_us, checks.lease_until_us,
    \\  checks.hinted_at_us
;

const complete_sql =
    \\UPDATE plyr_index.account_status_checks SET
    \\  next_attempt_at_us = CASE
    \\    WHEN hinted_at_us > $9 THEN LEAST($1, hinted_at_us)
    \\    ELSE $1
    \\  END,
    \\  lease_until_us = NULL,
    \\  last_completed_at_us = $2,
    \\  last_success_at_us = CASE WHEN $3::boolean THEN $2 ELSE last_success_at_us END,
    \\  consecutive_failures = CASE WHEN $3::boolean THEN 0 ELSE consecutive_failures + 1 END,
    \\  last_response_authoritative = CASE WHEN $3::boolean THEN $4::boolean ELSE NULL END,
    \\  last_outcome = $5::text
    \\WHERE repo_did = $6 AND last_attempt_at_us = $7 AND lease_until_us = $8
;

pub fn createTestTable(pool: *pg.Pool) !void {
    _ = try pool.exec(
        \\CREATE TABLE plyr_index.account_status_checks (
        \\  repo_did text PRIMARY KEY,
        \\  next_attempt_at_us bigint NOT NULL CHECK (next_attempt_at_us >= 0),
        \\  hinted_at_us bigint NOT NULL CHECK (hinted_at_us >= 0),
        \\  lease_until_us bigint CHECK (lease_until_us >= 0),
        \\  attempt_count bigint NOT NULL CHECK (attempt_count >= 0),
        \\  consecutive_failures integer NOT NULL CHECK (consecutive_failures >= 0),
        \\  last_attempt_at_us bigint CHECK (last_attempt_at_us >= 0),
        \\  last_completed_at_us bigint CHECK (last_completed_at_us >= 0),
        \\  last_success_at_us bigint CHECK (last_success_at_us >= 0),
        \\  last_response_authoritative boolean,
        \\  last_outcome text
        \\)
    , .{});
}

test "PostgreSQL schedule leases, deduplicates hints, and preserves in-flight hints" {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    const io = threaded.io();
    postgres_test_lock.lock(io);
    defer postgres_test_lock.unlock(io);
    const uri = try std.Uri.parse(std.mem.span(url_z));
    var pool = try pg.Pool.initUri(io, allocator, uri, .{ .size = 2 });
    defer pool.deinit();
    try requireDisposableDatabase(pool, allocator);
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{});
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_index CASCADE", .{}) catch null;
    _ = try pool.exec("CREATE SCHEMA plyr_index", .{});
    _ = try pool.exec("CREATE TABLE plyr_index.repo_heads (repo_did text PRIMARY KEY)", .{});
    try createTestTable(pool);
    _ = try pool.exec("INSERT INTO plyr_index.repo_heads VALUES ('did:plc:a')", .{});

    var implementation: PostgresCheckSchedule = .{ .pool = pool };
    const schedule = implementation.port();
    try std.testing.expectEqual(@as(usize, 1), try schedule.seed(100));
    try std.testing.expectEqual(@as(usize, 0), try schedule.seed(100));
    const claim = (try schedule.claim(allocator, 100, 50)).?;
    defer allocator.free(claim.repo_did);
    try std.testing.expect((try schedule.claim(allocator, 100, 50)) == null);
    try schedule.hint("did:plc:a", 110);
    try schedule.complete(.{
        .claim = claim,
        .completed_at_us = 120,
        .next_attempt_at_us = 1_000,
        .successful_response = true,
        .authoritative = true,
        .outcome = "available",
    });
    const hinted = (try schedule.claim(allocator, 120, 50)).?;
    defer allocator.free(hinted.repo_did);
    try std.testing.expectEqualStrings("did:plc:a", hinted.repo_did);
    try std.testing.expectError(error.LostLease, schedule.complete(.{
        .claim = claim,
        .completed_at_us = 121,
        .next_attempt_at_us = 1_000,
        .successful_response = false,
        .authoritative = false,
        .outcome = "transport_error",
    }));
}

fn requireDisposableDatabase(pool: *pg.Pool, allocator: std.mem.Allocator) !void {
    var row = (try pool.row("SELECT current_database()", .{})).?;
    defer row.deinit() catch {};
    const database = try allocator.dupe(u8, try row.get([]const u8, 0));
    defer allocator.free(database);
    if (!std.mem.eql(u8, database, "relay_test")) return error.UnsafeTestDatabase;
}
