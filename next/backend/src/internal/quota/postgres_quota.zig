//! Quotas (`plyr_quota`, migration 0064): how much of a metered resource an
//! account may spend per window, and everyone together may. The rules live in
//! the database functions so every process that meters something (this api's
//! report limit, the Osprey worker's fingerprint scans) gets the same answer
//! in its own transaction; this file is the backend's way in.

const std = @import("std");
const pg = @import("pg");

pub const Error = error{ Unavailable, Corrupt };

/// Meters the backend spends. The worker spends `scan_seconds`.
pub const Meter = enum {
    reports,
    scan_seconds,
};

pub const Grant = struct {
    granted: bool,
    /// the tier the subject was metered on (new, established, unmetered, ...)
    tier: []const u8,
    /// spent in the current window, including this spend when granted
    used: i64,
    /// the subject's allowance per window; null is no per-account limit
    allowance: ?i64,
    /// when the current window ends
    retry_at_us: i64,
};

/// Spend `amount` of `meter` for `subject` in the caller's transaction on
/// `conn`, or nothing. A rollback of that transaction returns the spend.
/// `tier` is copied into `allocator`.
pub fn spend(allocator: std.mem.Allocator, conn: *pg.Conn, meter: Meter, subject: []const u8, amount: i64) Error!Grant {
    var row = (conn.row(spend_query, .{ @tagName(meter), subject, amount }) catch |err| {
        if (conn.err) |pg_err|
            std.log.err("quota spend failed: {}: {s}", .{ err, pg_err.message })
        else
            std.log.err("quota spend failed: {}", .{err});
        return error.Unavailable;
    }) orelse return error.Corrupt;
    defer row.deinit() catch {};
    return .{
        .granted = row.get(bool, 0) catch return error.Corrupt,
        .tier = allocator.dupe(u8, row.get([]const u8, 1) catch return error.Corrupt) catch return error.Unavailable,
        .used = row.get(i64, 2) catch return error.Corrupt,
        .allowance = row.get(?i64, 3) catch return error.Corrupt,
        .retry_at_us = row.get(i64, 4) catch return error.Corrupt,
    };
}

const spend_query = "SELECT granted, tier, used, allowance, retry_at_us FROM plyr_quota.spend($1, $2, $3)";

/// Migration 0064, for tests in this file and those that meter through it.
pub fn resetTestSchema(pool: *pg.Pool) !void {
    _ = try pool.exec("DROP SCHEMA IF EXISTS plyr_quota CASCADE", .{});
    _ = try pool.exec(@embedFile("migration_0064_quota"), .{});
}

test "quota spends within the window's allowance and ceiling, by tier" {
    const url = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const allocator = std.testing.allocator;
    var threaded = std.Io.Threaded.init(allocator, .{});
    defer threaded.deinit();
    const io = threaded.io();
    const lock = @import("../testing/postgres_lock.zig");
    lock.lock(io);
    defer lock.unlock(io);
    var pool = try pg.Pool.initUri(io, allocator, try std.Uri.parse(std.mem.span(url)), .{ .size = 1 });
    defer pool.deinit();
    var name = (try pool.row("SELECT current_database()", .{})).?;
    const safe = std.mem.eql(u8, try name.get([]const u8, 0), "zig_test");
    try name.deinit();
    if (!safe) return error.UnsafeTestDatabase;
    try resetTestSchema(pool);
    defer _ = pool.exec("DROP SCHEMA IF EXISTS plyr_quota CASCADE", .{}) catch null;

    var arena_state = std.heap.ArenaAllocator.init(allocator);
    defer arena_state.deinit();
    const a = arena_state.allocator();
    const conn = try pool.acquire();
    defer pool.release(conn);

    // a new account: an hour of scanning a day
    var grant = try spend(a, conn, .scan_seconds, "did:plc:new", 3000);
    try std.testing.expect(grant.granted);
    try std.testing.expectEqualStrings("new", grant.tier);
    try std.testing.expectEqual(@as(?i64, 3600), grant.allowance);
    try std.testing.expect(grant.retry_at_us > 0);
    grant = try spend(a, conn, .scan_seconds, "did:plc:new", 1000);
    try std.testing.expect(!grant.granted);
    try std.testing.expectEqual(@as(i64, 3000), grant.used);
    grant = try spend(a, conn, .scan_seconds, "did:plc:new", 600);
    try std.testing.expect(grant.granted);

    // one file longer than the whole allowance goes through as the day's first
    grant = try spend(a, conn, .scan_seconds, "did:plc:long", 9000);
    try std.testing.expect(grant.granted);
    try std.testing.expect(!(try spend(a, conn, .scan_seconds, "did:plc:long", 1)).granted);

    // clean outcomes earn the established tier; one flagged keeps an account new
    _ = try conn.exec("SELECT plyr_quota.record_outcome('did:plc:steady', true) FROM generate_series(1, 5)", .{});
    grant = try spend(a, conn, .scan_seconds, "did:plc:steady", 10000);
    try std.testing.expectEqualStrings("established", grant.tier);
    try std.testing.expectEqual(@as(?i64, 21600), grant.allowance);
    _ = try conn.exec("SELECT plyr_quota.record_outcome('did:plc:steady', false)", .{});
    try std.testing.expectEqualStrings("new", (try spend(a, conn, .scan_seconds, "did:plc:steady", 0)).tier);

    // an operator's tier has no per-account limit, but the ceiling still holds
    _ = try conn.exec("INSERT INTO plyr_quota.account_tiers (subject, tier, source) VALUES ('did:plc:op', 'unmetered', 'operator')", .{});
    grant = try spend(a, conn, .scan_seconds, "did:plc:op", 50000);
    try std.testing.expect(grant.granted);
    try std.testing.expectEqual(@as(?i64, null), grant.allowance);
    // 3600 + 9000 + 10000 + 50000 spent so far; the day's ceiling is 108000
    try std.testing.expect(!(try spend(a, conn, .scan_seconds, "did:plc:op", 40000)).granted);
    try std.testing.expect((try spend(a, conn, .scan_seconds, "did:plc:op", 35400)).granted);
    try std.testing.expect(!(try spend(a, conn, .scan_seconds, "did:plc:fresh", 1)).granted);

    // a released spend is room again
    _ = try conn.exec("SELECT plyr_quota.release('scan_seconds', 'did:plc:op', 400)", .{});
    try std.testing.expect((try spend(a, conn, .scan_seconds, "did:plc:fresh", 400)).granted);

    // meters are separate: reports are 30 an hour on every metered tier
    var sent: usize = 0;
    while (sent < 30) : (sent += 1) try std.testing.expect((try spend(a, conn, .reports, "did:plc:new", 1)).granted);
    try std.testing.expect(!(try spend(a, conn, .reports, "did:plc:new", 1)).granted);
    try std.testing.expect((try spend(a, conn, .reports, "did:plc:op", 1)).granted);

    // a rolled-back transaction leaves nothing spent
    _ = try conn.exec("BEGIN", .{});
    try std.testing.expect((try spend(a, conn, .reports, "did:plc:other", 30)).granted);
    _ = try conn.exec("ROLLBACK", .{});
    try std.testing.expectEqual(@as(i64, 1), (try spend(a, conn, .reports, "did:plc:other", 1)).used);
}
