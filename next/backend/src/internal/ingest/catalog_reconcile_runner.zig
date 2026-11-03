//! Runtime wiring for one-shot source-authenticated catalog reconciliation.

const std = @import("std");
const relay_cursor_store = @import("postgres_relay_cursor.zig");
const pg = @import("pg");
const catalog = @import("catalog_reconciler.zig");
const candidates = @import("postgres_repository_candidates.zig");
const relay_candidates = @import("relay_repository_candidates.zig");
const repository_candidates = @import("repository_candidates.zig");
const repair_runner = @import("repair_runner.zig");

pub fn run(
    io: std.Io,
    allocator: std.mem.Allocator,
    pool: *pg.Pool,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    like_collection: []const u8,
    /// also discover every repo the relay saw write a plyr collection
    discovery_relay: ?[]const u8,
) !catalog.Report {
    var postgres_adapter: candidates.PostgresRepositoryCandidates = .{ .pool = pool };
    const collections = [_][]const u8{ track_collection, list_collection, profile_collection, like_collection };
    var relay_adapter: relay_candidates.RelayRepositoryCandidates = .{
        .io = io,
        .relay = discovery_relay orelse "",
        .collections = &collections,
    };
    var union_adapter: Union = .{
        .first = postgres_adapter.source(),
        .second = if (discovery_relay != null) relay_adapter.source() else null,
    };
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

    const report = try catalog.reconcile(allocator, union_adapter.source(), .{
        .context = &repairs,
        .repair_fn = repairOpaque,
    });
    if (report.complete()) {
        const now_us: i64 = @intCast(@divFloor(std.Io.Timestamp.now(io, .real).nanoseconds, std.time.ns_per_us));
        var checkpoint: relay_cursor_store.PostgresRelayCursor = .{ .pool = pool };
        checkpoint.store().save(completed_source, now_us, now_us) catch |err|
            std.log.warn("could not record the reconcile time: {}", .{err});
    }
    return report;
}

/// Checkpoint in plyr_index.relay_cursors whose seq is the time_us of the
/// last complete catalog reconciliation, read by /v1/health/ingest.
pub const completed_source = "catalog_reconcile";

/// Distinct DIDs from both sources, in first-seen order.
const Union = struct {
    first: repository_candidates.Source,
    second: ?repository_candidates.Source,

    fn source(self: *Union) repository_candidates.Source {
        return .{ .context = self, .list_fn = listOpaque };
    }

    fn listOpaque(context: *anyopaque, allocator: std.mem.Allocator) repository_candidates.Error!repository_candidates.CandidateSet {
        const self: *Union = @ptrCast(@alignCast(context));
        var first = try self.first.list(allocator);
        const second_source = self.second orelse return first;
        errdefer first.deinit(allocator);
        var second = try second_source.list(allocator);
        defer second.deinit(allocator);
        var seen: std.StringHashMapUnmanaged(void) = .empty;
        defer seen.deinit(allocator);
        var items: std.ArrayListUnmanaged([]u8) = .empty;
        errdefer {
            for (items.items) |item| allocator.free(item);
            items.deinit(allocator);
        }
        for ([_][][]u8{ first.items, second.items }) |list| for (list) |did| {
            if (seen.contains(did)) continue;
            const owned = allocator.dupe(u8, did) catch return error.OutOfMemory;
            items.append(allocator, owned) catch {
                allocator.free(owned);
                return error.OutOfMemory;
            };
            seen.put(allocator, owned, {}) catch return error.OutOfMemory;
        };
        first.deinit(allocator);
        return .{ .items = items.toOwnedSlice(allocator) catch return error.OutOfMemory };
    }
};

fn repairOpaque(
    context: *anyopaque,
    allocator: std.mem.Allocator,
    did: []const u8,
) catalog.RepairError!@import("projector.zig").RepairOutcome {
    const runner: *repair_runner.Runner = @ptrCast(@alignCast(context));
    return runner.repair(allocator, did);
}
