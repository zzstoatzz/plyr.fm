//! /v1/health/ingest renders checkpoints written by other processes, read
//! against this machine's clock. Any 64-bit checkpoint and clock must render
//! without crashing, with ages that are finite, never negative, and zero
//! exactly when the checkpoint is not behind the clock.

const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const get_ingest_status = @import("../internal/application/get_ingest_status.zig");
const store_module = @import("../internal/index/ingest_status_store.zig");

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{
        .{ "health.ingest_view", ingestView },
    });
}

fn micros(case: *hegel.TestCase) !?i64 {
    return switch (try case.int(u8, 0, 3)) {
        0 => null,
        1 => try case.int(i64, std.math.minInt(i64), std.math.maxInt(i64)),
        else => try case.int(i64, 1_700_000_000_000_000, 1_800_000_000_000_000),
    };
}

fn ingestView(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const now = (try micros(case)) orelse 1_786_000_000_000_000;
    const status: store_module.Status = .{
        .stream_cursor_us = try micros(case),
        .stream_checkpointed_at_us = try micros(case),
        .reconciled_at_us = try micros(case),
        .label_seq = try micros(case),
        .label_synced_at_us = try micros(case),
        .mirror_pending = try case.int(u64, 0, store_module.backlog_cap),
        .mirror_retrying = try case.int(u64, 0, 100),
    };
    case.note("now {d}, cursor {?d}", .{ now, status.stream_cursor_us });
    const view = try get_ingest_status.view(arena.allocator(), status, now);
    const pairs = [_]struct { ?i64, get_ingest_status.Checkpoint }{
        .{ status.stream_cursor_us, view.stream.cursor },
        .{ status.stream_checkpointed_at_us, view.stream.checkpointed },
        .{ status.reconciled_at_us, view.reconcile },
        .{ status.label_synced_at_us, view.labels.synced },
    };
    for (pairs) |pair| {
        const then = pair[0] orelse {
            if (pair[1].age_seconds != null or pair[1].at != null) return case.fail("a missing checkpoint has an age");
            continue;
        };
        const age = pair[1].age_seconds orelse return case.fail("a checkpoint has no age");
        if (!std.math.isFinite(age) or age < 0) return case.fail("an age is negative or not finite");
        if ((age == 0) != (then >= now)) return case.fail("age is zero exactly when the checkpoint is not behind");
        if (pair[1].at) |at| {
            if (at.len != 27 or at[26] != 'Z') return case.fail("a checkpoint renders outside the canonical form");
            case.event("checkpoint rendered");
        }
    }
    _ = try std.json.Stringify.valueAlloc(arena.allocator(), view, .{});
}
