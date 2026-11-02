//! Runtime wiring for one-shot source-authenticated catalog reconciliation.

const std = @import("std");
const pg = @import("pg");
const catalog = @import("catalog_reconciler.zig");
const candidates = @import("postgres_repository_candidates.zig");
const repair_runner = @import("repair_runner.zig");

pub fn run(
    io: std.Io,
    allocator: std.mem.Allocator,
    pool: *pg.Pool,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
) !catalog.Report {
    var candidate_adapter: candidates.PostgresRepositoryCandidates = .{ .pool = pool };
    var repairs: repair_runner.Runner = undefined;
    repairs.init(
        io,
        allocator,
        pool,
        list_collection,
        track_collection,
        profile_collection,
        like_collection,
    );
    defer repairs.deinit();

    return catalog.reconcile(allocator, candidate_adapter.source(), .{
        .context = &repairs,
        .repair_fn = repairOpaque,
    });
}

fn repairOpaque(
    context: *anyopaque,
    allocator: std.mem.Allocator,
    did: []const u8,
) catalog.RepairError!@import("projector.zig").RepairOutcome {
    const runner: *repair_runner.Runner = @ptrCast(@alignCast(context));
    return runner.repair(allocator, did);
}
