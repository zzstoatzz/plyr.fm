//! One-shot reconciliation of candidate repositories into verified projections.

const std = @import("std");
const candidates = @import("repository_candidates.zig");
const projector = @import("projector.zig");

pub const RepairError = projector.Error || error{InvalidSystemClock};

pub const Repairer = struct {
    context: *anyopaque,
    repair_fn: *const fn (
        *anyopaque,
        std.mem.Allocator,
        []const u8,
    ) RepairError!projector.RepairOutcome,

    pub fn repair(
        self: Repairer,
        allocator: std.mem.Allocator,
        did: []const u8,
    ) RepairError!projector.RepairOutcome {
        return self.repair_fn(self.context, allocator, did);
    }
};

pub const Report = struct {
    candidates: usize = 0,
    verified: usize = 0,
    absent: usize = 0,
    retryable: usize = 0,
    rejected: usize = 0,

    pub fn complete(self: Report) bool {
        return self.candidates > 0 and self.verified > 0 and
            self.retryable == 0 and self.rejected == 0;
    }
};

pub fn reconcile(
    allocator: std.mem.Allocator,
    source: candidates.Source,
    repairer: Repairer,
) !Report {
    var found = try source.list(allocator);
    defer found.deinit(allocator);
    var report: Report = .{ .candidates = found.items.len };
    for (found.items) |did| {
        var arena = std.heap.ArenaAllocator.init(allocator);
        defer arena.deinit();
        const outcome = try repairer.repair(arena.allocator(), did);
        switch (outcome) {
            .applied, .idempotent, .stale => report.verified += 1,
            .not_found => report.absent += 1,
            .rate_limited, .unavailable => report.retryable += 1,
            else => report.rejected += 1,
        }
        std.log.info("catalog repository {s}: {s}", .{ did, @tagName(outcome) });
    }
    return report;
}

test "catalog reconciliation counts every disposition and requires verified work" {
    const SourceFake = struct {
        fn list(_: *anyopaque, allocator: std.mem.Allocator) candidates.Error!candidates.CandidateSet {
            const values = [_][]const u8{ "did:plc:good", "did:plc:gone", "did:plc:later", "did:plc:bad" };
            const items = allocator.alloc([]u8, values.len) catch return error.OutOfMemory;
            var initialized: usize = 0;
            errdefer {
                for (items[0..initialized]) |item| allocator.free(item);
                allocator.free(items);
            }
            for (values, items) |value, *item| {
                item.* = allocator.dupe(u8, value) catch return error.OutOfMemory;
                initialized += 1;
            }
            return .{ .items = items };
        }
    };
    const RepairFake = struct {
        fn repair(
            _: *anyopaque,
            _: std.mem.Allocator,
            did: []const u8,
        ) RepairError!projector.RepairOutcome {
            if (std.mem.endsWith(u8, did, "good")) return .applied;
            if (std.mem.endsWith(u8, did, "gone")) return .not_found;
            if (std.mem.endsWith(u8, did, "later")) return .rate_limited;
            return .invalid_signature;
        }
    };
    var context: u8 = 0;
    const report = try reconcile(
        std.testing.allocator,
        .{ .context = &context, .list_fn = SourceFake.list },
        .{ .context = &context, .repair_fn = RepairFake.repair },
    );
    try std.testing.expectEqual(@as(usize, 4), report.candidates);
    try std.testing.expectEqual(@as(usize, 1), report.verified);
    try std.testing.expectEqual(@as(usize, 1), report.absent);
    try std.testing.expectEqual(@as(usize, 1), report.retryable);
    try std.testing.expectEqual(@as(usize, 1), report.rejected);
    try std.testing.expect(!report.complete());
}
