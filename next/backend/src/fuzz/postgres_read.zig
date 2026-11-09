//! The read path retries a query once when its pooled connection is gone,
//! and only statements the read-only check accepts may use it. Two
//! properties pin those boundaries:
//!
//! - retry policy: any failure history retries at most once, never after a
//!   query error, and always after a connection failure on the first try.
//! - read-only check: SQL assembled from fragments with a known answer
//!   (comments and quoted text that mention write keywords, separators and
//!   keywords outside them) is accepted exactly when no write keyword or
//!   separator appears outside a comment or quote.

const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const postgres_read = @import("../internal/index/postgres_read.zig");

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{
        .{ "postgres_read.retry_policy", retryPolicy },
        .{ "postgres_read.read_only_sql", readOnlySql },
    });
}

const transport_errors = [_]anyerror{ error.Closed, error.EndOfStream, error.ReadFailed, error.WriteFailed, error.ConnectionResetByPeer, error.BrokenPipe, error.SSLReadFailed, error.SSLWriteFailed };
const other_errors = [_]anyerror{ error.Timeout, error.PoolExhausted, error.OutOfMemory, error.WrongNumberOfParameters, error.ConnectionBusy, error.UnexpectedDBMessage, error.Canceled };
const connection_states = [_][]const u8{ "57P01", "57P02", "57P03", "57P05", "08000", "08003", "08006", "08P01", "0A000" };
const query_states = [_][]const u8{ "57014", "42601", "42P01", "23505", "22012", "40001", "40P01", "53300", "0A001", "08", "57P" };

const Failure = struct { err: anyerror, sqlstate: ?[]const u8, connection: bool };

fn failure(case: *hegel.TestCase, allocator: std.mem.Allocator) !Failure {
    return switch (try case.int(u8, 0, 4)) {
        0 => .{ .err = transport_errors[try case.index(transport_errors.len)], .sqlstate = null, .connection = true },
        1 => .{ .err = error.PG, .sqlstate = try gen.pick(case, []const u8, &connection_states), .connection = true },
        2 => .{ .err = error.PG, .sqlstate = try gen.pick(case, []const u8, &query_states), .connection = false },
        3 => blk: {
            // arbitrary five-character states: retry exactly for 08xxx, 57Pxx, 0A000
            const code = try gen.string(case, allocator, "0123456789APZ", 0, 6);
            const connection = code.len == 5 and (std.mem.startsWith(u8, code, "08") or
                std.mem.startsWith(u8, code, "57P") or std.mem.eql(u8, code, "0A000"));
            break :blk .{ .err = error.PG, .sqlstate = code, .connection = connection };
        },
        else => .{ .err = other_errors[try case.index(other_errors.len)], .sqlstate = if (try case.boolean()) "57P01" else null, .connection = false },
    };
}

fn retryPolicy(_: void, case: *hegel.TestCase) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    // Drive the same loop `postgres_read.query` runs: each attempt either
    // succeeds or fails with a drawn failure, until the policy stops it.
    const history_len = try case.int(usize, 0, 8);
    var attempts: u8 = 0;
    var first: ?Failure = null;
    var succeeded = false;
    while (true) {
        attempts += 1;
        if (attempts > history_len) {
            succeeded = true;
            break;
        }
        const f = try failure(case, arena.allocator());
        if (first == null) first = f;
        case.note("attempt {d}: {} {?s}", .{ attempts, f.err, f.sqlstate });
        const retry = postgres_read.shouldRetry(attempts, f.err, f.sqlstate);
        if (retry != (attempts == 1 and f.connection)) return case.fail("retry decision disagrees with the policy");
        if (!retry) break;
    }
    if (attempts > 2) return case.fail("more than one retry");
    if (!succeeded) {
        if (first) |f| if (attempts == 1 and f.connection) return case.fail("a first connection failure was not retried");
    }
    if (attempts == 2) case.event("retried");
}

const Piece = struct { text: []const u8, writes: bool };

const words = [_][]const u8{ "insert", "UPDATE", "Delete", "merge", "truncate", "copy", "call", "do", "lock", "into", "nextval", "setval" };
const safe_words = [_][]const u8{ "updated_at", "is_deleted", "inserted", "docs", "locked_by", "intogether", "copying", "recall", "domain", "t.update_count" };

fn piece(case: *hegel.TestCase, allocator: std.mem.Allocator) !Piece {
    const word = try gen.pick(case, []const u8, &words);
    return switch (try case.int(u8, 0, 7)) {
        // comments and quotes hide everything inside them
        0 => .{ .text = try std.fmt.allocPrint(allocator, " -- {s}; {s}\n", .{ word, word }), .writes = false },
        1 => .{ .text = try std.fmt.allocPrint(allocator, " /* {s}; */ ", .{word}), .writes = false },
        2 => .{ .text = try std.fmt.allocPrint(allocator, " '{s}''; {s}' ", .{ word, word }), .writes = false },
        3 => .{ .text = try std.fmt.allocPrint(allocator, " \"{s}\" ", .{word}), .writes = false },
        4 => .{ .text = try std.fmt.allocPrint(allocator, " {s} ", .{try gen.pick(case, []const u8, &safe_words)}), .writes = false },
        5 => .{ .text = try std.fmt.allocPrint(allocator, " ${d} ", .{try case.int(u8, 1, 9)}), .writes = false },
        // outside a comment or quote, a keyword or separator is a write
        6 => .{ .text = try std.fmt.allocPrint(allocator, " {s} ", .{word}), .writes = true },
        else => .{ .text = if (try case.boolean()) " ; " else "(x);", .writes = true },
    };
}

fn readOnlySql(_: void, case: *hegel.TestCase) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var sql: std.ArrayList(u8) = .empty;
    var writes = false;
    const lead = try case.int(u8, 0, 3);
    switch (lead) {
        0 => try sql.appendSlice(allocator, "SELECT 1"),
        1 => try sql.appendSlice(allocator, "\n  with x AS (SELECT a FROM t)"),
        2 => try sql.appendSlice(allocator, "-- SELECT\nselect b FROM t"),
        else => {
            // not a SELECT at all
            try sql.appendSlice(allocator, try gen.pick(case, []const u8, &.{ "VALUES (1)", "EXPLAIN SELECT 1", "selection", "" }));
            writes = true;
        },
    }
    for (0..try case.int(usize, 0, 6)) |_| {
        const p = try piece(case, allocator);
        writes = writes or p.writes;
        try sql.appendSlice(allocator, p.text);
    }
    case.note("{s}", .{sql.items});
    if (postgres_read.isReadOnlySql(sql.items) == writes) return case.fail("read-only check disagrees with the fragments");
    if (writes) case.event("rejected") else case.event("accepted");
}
