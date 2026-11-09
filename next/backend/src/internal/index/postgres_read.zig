//! Read-only Postgres queries for the appview's request path.
//!
//! Two things every hot read wants and pg.zig's pool helpers don't do:
//!
//! - **Named prepared statements.** pg.zig sends unnamed statements by
//!   default, so each request re-parses and re-plans the query. Passing a
//!   `cache_name` keeps the statement prepared on the connection. The name is
//!   derived from the SQL text at comptime, so two different queries can never
//!   share a name and a name can never point at different SQL.
//!
//! - **One retry on a broken connection.** When Neon suspends (or fails over,
//!   or an operator kills backends), every pooled connection is dead, and the
//!   next request on each one fails. A read that fails because its connection
//!   is gone is retried exactly once. The failed connection is marked failed
//!   before release, so the pool replaces it with a new one; the pool hands
//!   connections out last-in-first-out, so the retry normally runs on that
//!   replacement rather than on another stale connection.
//!
//! Only statements that `isReadOnlySql` accepts can go through here, checked
//! at comptime, so a write can never be retried by accident. Query errors
//! (syntax, constraints, bad parameters) are never retried. Errors raised
//! while streaming rows after the first one are not retried either, because
//! the caller may already have consumed rows.

const std = @import("std");
const pg = @import("pg");

/// The statement name pg.zig caches `sql` under on each connection.
pub fn statementName(comptime sql: []const u8) []const u8 {
    comptime {
        @setEvalBranchQuota(100_000);
        return std.fmt.comptimePrint("plyr_read_{x:0>16}", .{std.hash.Wyhash.hash(0, sql)});
    }
}

/// Whether a failed attempt should be retried on a fresh connection. Pure, so
/// the property harness can drive it directly: at most one retry, and only
/// when the failure says the connection itself is gone.
pub fn shouldRetry(attempts_so_far: u8, err: anyerror, sqlstate: ?[]const u8) bool {
    if (attempts_so_far != 1) return false;
    return isConnectionFailure(err, sqlstate);
}

/// Transport failures, plus the server-reported SQLSTATEs that mean the
/// connection (not the query) is unusable:
///
/// - class `08`: connection exception
/// - class `57P`: operator intervention that ends the session (`57P01`
///   admin shutdown is what Neon suspend and `pg_terminate_backend` send).
///   `57014` (query cancelled, statement timeout) is deliberately excluded.
/// - `0A000` from a cached plan whose result type changed after a schema
///   change; a new connection prepares the statement again.
pub fn isConnectionFailure(err: anyerror, sqlstate: ?[]const u8) bool {
    return switch (err) {
        error.Closed,
        error.EndOfStream,
        error.ReadFailed,
        error.WriteFailed,
        error.ConnectionResetByPeer,
        error.BrokenPipe,
        error.SSLReadFailed,
        error.SSLWriteFailed,
        => true,
        error.PG => if (sqlstate) |code| isConnectionSqlState(code) else false,
        else => false,
    };
}

pub fn isConnectionSqlState(code: []const u8) bool {
    if (code.len != 5) return false;
    if (std.mem.startsWith(u8, code, "08")) return true;
    if (std.mem.startsWith(u8, code, "57P")) return true;
    return std.mem.eql(u8, code, "0A000");
}

/// True when `sql` is a single SELECT (optionally behind a WITH) that contains
/// no data-modifying keyword as a whole word and no statement separator.
/// Deliberately conservative: a false negative only means a query can't use
/// this module.
pub fn isReadOnlySql(sql: []const u8) bool {
    return readOnlyViolation(sql) == null;
}

/// Why `sql` is not accepted as read-only, or null when it is. Comments and
/// quoted literals/identifiers are skipped, so prose in a `--` comment or a
/// `LIKE 'x;y'` pattern can't trip the check.
pub fn readOnlyViolation(sql: []const u8) ?[]const u8 {
    var first_word: ?[]const u8 = null;
    var index: usize = 0;
    while (index < sql.len) {
        const byte = sql[index];
        if (byte == '-' and index + 1 < sql.len and sql[index + 1] == '-') {
            while (index < sql.len and sql[index] != '\n') index += 1;
            continue;
        }
        if (byte == '/' and index + 1 < sql.len and sql[index + 1] == '*') {
            const close = std.mem.indexOfPos(u8, sql, index + 2, "*/") orelse return "has an unterminated comment";
            index = close + 2;
            continue;
        }
        if (byte == '\'' or byte == '"') {
            index += 1;
            while (true) {
                if (index >= sql.len) return "has an unterminated quote";
                if (sql[index] == byte) {
                    // a doubled quote is an escaped quote, not the end
                    if (index + 1 < sql.len and sql[index + 1] == byte) {
                        index += 2;
                        continue;
                    }
                    index += 1;
                    break;
                }
                index += 1;
            }
            continue;
        }
        if (byte == '$' and index + 1 < sql.len and !std.ascii.isDigit(sql[index + 1])) return "uses dollar quoting";
        if (byte == ';') return "contains a statement separator";
        if (!isWordByte(byte)) {
            index += 1;
            continue;
        }
        const start = index;
        while (index < sql.len and isWordByte(sql[index])) index += 1;
        const word = sql[start..index];
        if (first_word == null) {
            first_word = word;
            if (!std.ascii.eqlIgnoreCase(word, "select") and !std.ascii.eqlIgnoreCase(word, "with"))
                return "does not start with SELECT or WITH";
        }
        for (forbidden_words) |keyword| {
            if (std.ascii.eqlIgnoreCase(word, keyword)) return keyword;
        }
    }
    if (first_word == null) return "is empty";
    return null;
}

const forbidden_words = [_][]const u8{ "insert", "update", "delete", "merge", "truncate", "copy", "call", "do", "lock", "into", "nextval", "setval", "pg_advisory_lock", "pg_advisory_xact_lock" };

fn isWordByte(byte: u8) bool {
    return std.ascii.isAlphanumeric(byte) or byte == '_';
}

fn assertReadOnly(comptime sql: []const u8) void {
    comptime {
        @setEvalBranchQuota(1_000_000);
        if (readOnlyViolation(sql)) |reason| @compileError("postgres_read only runs read-only SELECT statements: " ++ reason);
    }
}

/// `pool.query`, prepared and retried. The result releases its connection on
/// `deinit`, exactly like `pg.Pool.query`.
pub fn query(pool: *pg.Pool, comptime label: []const u8, comptime sql: []const u8, values: anytype) !*pg.Result {
    return run(pool, label, sql, values, .prepared);
}

/// `query` without a named statement, still retried. For queries whose best
/// plan depends heavily on the parameter values (trigram search): after five
/// executions Postgres may switch a prepared statement to a generic plan, and
/// for these that plan is slower than re-planning.
pub fn queryUnprepared(pool: *pg.Pool, comptime label: []const u8, comptime sql: []const u8, values: anytype) !*pg.Result {
    return run(pool, label, sql, values, .unprepared);
}

const Planning = enum { prepared, unprepared };

fn queryOptions(comptime sql: []const u8, comptime planning: Planning) pg.Conn.QueryOpts {
    return .{ .cache_name = switch (planning) {
        .prepared => comptime statementName(sql),
        .unprepared => null,
    } };
}

fn run(pool: *pg.Pool, comptime label: []const u8, comptime sql: []const u8, values: anytype, comptime planning: Planning) !*pg.Result {
    assertReadOnly(sql);
    var attempts: u8 = 0;
    while (true) {
        attempts += 1;
        const conn = try pool.acquire();
        const result = conn.queryOpts(sql, values, comptime queryOptions(sql, planning)) catch |err| {
            if (try finishFailure(pool, conn, label, attempts, err)) continue;
            return err;
        };
        result._release_conn = true;
        return result;
    }
}

/// `pool.row`, prepared and retried. The first row is part of the retried
/// attempt; the returned row releases its connection on `deinit`.
pub fn row(pool: *pg.Pool, comptime label: []const u8, comptime sql: []const u8, values: anytype) !?pg.QueryRow {
    assertReadOnly(sql);
    var attempts: u8 = 0;
    while (true) {
        attempts += 1;
        const conn = try pool.acquire();
        const result = conn.queryOpts(sql, values, comptime queryOptions(sql, .prepared)) catch |err| {
            if (try finishFailure(pool, conn, label, attempts, err)) continue;
            return err;
        };
        const first = result.next() catch |err| {
            result.deinit();
            if (try finishFailure(pool, conn, label, attempts, err)) continue;
            return err;
        };
        result._release_conn = true;
        const value = first orelse {
            result.deinit();
            return null;
        };
        return .{ .result = result, .row = value };
    }
}

/// Logs the failure, releases the connection, and says whether to retry.
/// A retryable connection is released as failed so the pool replaces it.
/// Logged as a warning: the caller decides whether a final failure is an
/// error, and this line is where the SQLSTATE and server message survive
/// (the connection forgets them on release).
fn finishFailure(pool: *pg.Pool, conn: *pg.Conn, comptime label: []const u8, attempts: u8, err: anyerror) error{Canceled}!bool {
    const sqlstate: ?[]const u8 = if (err == error.PG) if (conn.err) |pg_err| pg_err.code else null else null;
    const retry = shouldRetry(attempts, err, sqlstate);
    if (conn.err) |pg_err| {
        std.log.warn("{s} failed (attempt {d}): {}: {s} {s}", .{ label, attempts, err, pg_err.code, pg_err.message });
    } else {
        std.log.warn("{s} failed (attempt {d}): {}", .{ label, attempts, err });
    }
    if (retry) conn._state = .fail;
    pool.release(conn);
    if (err == error.Canceled) return error.Canceled;
    if (retry) std.log.warn("{s}: retrying once on a fresh connection", .{label});
    return retry;
}

test "statement names are stable, distinct per SQL, and valid identifiers" {
    const a = comptime statementName("SELECT 1");
    const b = comptime statementName("SELECT 2");
    try std.testing.expect(!std.mem.eql(u8, a, b));
    try std.testing.expectEqualStrings(a, comptime statementName("SELECT 1"));
    try std.testing.expect(a.len < 64);
    for (a) |byte| try std.testing.expect(isWordByte(byte));
}

test "retry policy: one retry, connection failures only" {
    try std.testing.expect(shouldRetry(1, error.EndOfStream, null));
    try std.testing.expect(shouldRetry(1, error.PG, "57P01"));
    try std.testing.expect(shouldRetry(1, error.PG, "08006"));
    try std.testing.expect(shouldRetry(1, error.PG, "0A000"));
    try std.testing.expect(!shouldRetry(2, error.EndOfStream, null));
    try std.testing.expect(!shouldRetry(1, error.PG, "57014"));
    try std.testing.expect(!shouldRetry(1, error.PG, "42601"));
    try std.testing.expect(!shouldRetry(1, error.PG, "23505"));
    try std.testing.expect(!shouldRetry(1, error.PG, null));
    try std.testing.expect(!shouldRetry(1, error.WrongNumberOfParameters, null));
    try std.testing.expect(!shouldRetry(1, error.Timeout, null));
    try std.testing.expect(!shouldRetry(1, error.OutOfMemory, null));
}

test "read-only classifier" {
    try std.testing.expect(isReadOnlySql("SELECT 1"));
    try std.testing.expect(isReadOnlySql("\n  WITH x AS (SELECT updated_at, is_deleted FROM t) SELECT * FROM x"));
    try std.testing.expect(!isReadOnlySql("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x"));
    try std.testing.expect(!isReadOnlySql("SELECT 1; DELETE FROM t"));
    try std.testing.expect(!isReadOnlySql("SELECT * INTO t2 FROM t"));
    try std.testing.expect(!isReadOnlySql("SELECT * FROM t FOR UPDATE"));
    try std.testing.expect(!isReadOnlySql("SELECT nextval('s')"));
    try std.testing.expect(!isReadOnlySql("INSERT INTO t VALUES (1)"));
    try std.testing.expect(!isReadOnlySql("selection"));
    try std.testing.expect(isReadOnlySql("SELECT 1 -- a comment; with a semicolon and delete\n"));
    try std.testing.expect(isReadOnlySql("SELECT 'it''s; insert' AS \"update\" FROM t /* drop; delete */"));
    try std.testing.expect(!isReadOnlySql("SELECT 'unterminated"));
    try std.testing.expect(!isReadOnlySql("SELECT $x$ ; $x$"));
    try std.testing.expect(isReadOnlySql("SELECT $1, $2::int"));
    try std.testing.expect(!isReadOnlySql("-- SELECT\nDELETE FROM t"));
    try std.testing.expect(!isReadOnlySql(""));
}

fn testPool(io: std.Io, size: u16) !*pg.Pool {
    const url_z = std.c.getenv("PLYR_ZIG_TEST_DATABASE_URL") orelse return error.SkipZigTest;
    const uri = try std.Uri.parse(std.mem.span(url_z));
    return pg.Pool.initUri(io, std.testing.allocator, uri, .{ .size = size });
}

fn terminateOthers(io: std.Io, victim_pids: []const i32) !void {
    var killer = try testPool(io, 1);
    defer killer.deinit();
    for (victim_pids) |pid| {
        var killed = (try killer.row("SELECT pg_terminate_backend($1)", .{pid})).?;
        defer killed.deinit() catch {};
        try std.testing.expect(try killed.get(bool, 0));
    }
    // pg_terminate_backend only signals; wait until the backends are gone.
    var tries: usize = 0;
    while (tries < 200) : (tries += 1) {
        var left = (try killer.row("SELECT count(*)::bigint FROM pg_stat_activity WHERE pid = ANY($1)", .{victim_pids})).?;
        const count = try left.get(i64, 0);
        try left.deinit();
        if (count == 0) return;
        try io.sleep(.fromMilliseconds(10), .awake);
    }
    return error.BackendsSurvived;
}

test "a read survives every pooled connection being terminated" {
    const io = std.testing.io;
    var pool = try testPool(io, 2);
    defer pool.deinit();

    // Learn both connections' backend pids by holding them at once.
    var pids: [2]i32 = undefined;
    {
        const a = try pool.acquire();
        const b = try pool.acquire();
        defer pool.release(a);
        defer pool.release(b);
        for ([_]*pg.Conn{ a, b }, 0..) |conn, i| {
            var pid_row = (try conn.row("SELECT pg_backend_pid()", .{})).?;
            pids[i] = try pid_row.get(i32, 0);
            try pid_row.deinit();
        }
    }
    try terminateOthers(io, &pids);

    // Both connections are now dead. Each read must still succeed: the first
    // retries onto the replacement, the second meets the other dead one and
    // retries too.
    for (0..2) |_| {
        var answer = (try row(pool, "terminate test", "SELECT 41 + 1", .{})).?;
        try std.testing.expectEqual(@as(i32, 42), try answer.get(i32, 0));
        try answer.deinit();
    }
    var result = try query(pool, "terminate test", "SELECT generate_series(1, 3)", .{});
    defer result.deinit();
    var seen: i32 = 0;
    while (try result.next()) |r| seen += try r.get(i32, 0);
    try std.testing.expectEqual(@as(i32, 6), seen);
}

test "a query error is not retried and leaves the connection usable" {
    const io = std.testing.io;
    var pool = try testPool(io, 1);
    defer pool.deinit();
    try std.testing.expectError(error.PG, row(pool, "error test", "SELECT 1 / $1::int", .{@as(i32, 0)}));
    var ok = (try row(pool, "error test", "SELECT 1 / $1::int", .{@as(i32, 1)})).?;
    try std.testing.expectEqual(@as(i32, 1), try ok.get(i32, 0));
    try ok.deinit();
    const stats = pool.stats();
    try std.testing.expectEqual(@as(usize, 1), stats.available);
}

test "the prepared statement is reused on the same connection" {
    const io = std.testing.io;
    var pool = try testPool(io, 1);
    defer pool.deinit();
    for (0..3) |i| {
        var answer = (try row(pool, "prepared test", "SELECT $1::int + 1", .{@as(i32, @intCast(i))})).?;
        try std.testing.expectEqual(@as(i32, @intCast(i + 1)), try answer.get(i32, 0));
        try answer.deinit();
    }
    var prepared = (try pool.row("SELECT count(*)::bigint FROM pg_prepared_statements WHERE name = $1", .{comptime statementName("SELECT $1::int + 1")})).?;
    defer prepared.deinit() catch {};
    // pool.row ran on the same single connection, so it sees its statements.
    try std.testing.expectEqual(@as(i64, 1), try prepared.get(i64, 0));
}
