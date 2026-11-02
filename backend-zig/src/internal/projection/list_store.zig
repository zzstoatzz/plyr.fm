//! Persistence port for source-authoritative list projection changes.

const std = @import("std");
const list_change = @import("list_change.zig");

pub const ApplyResult = enum {
    applied,
    idempotent,
    stale,
};

pub const ListStore = struct {
    context: *anyopaque,
    apply_fn: *const fn (
        *anyopaque,
        std.mem.Allocator,
        list_change.Change,
    ) Error!ApplyResult,

    pub const Error = error{
        ProjectionUnavailable,
        RevisionConflict,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn apply(
        self: ListStore,
        allocator: std.mem.Allocator,
        change: list_change.Change,
    ) Error!ApplyResult {
        return self.apply_fn(self.context, allocator, change);
    }
};

test "list projection persistence is behind a storage-independent port" {
    const Fake = struct {
        applied: usize = 0,

        fn store(self: *@This()) ListStore {
            return .{ .context = self, .apply_fn = apply };
        }

        fn apply(
            context: *anyopaque,
            _: std.mem.Allocator,
            _: list_change.Change,
        ) ListStore.Error!ApplyResult {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.applied += 1;
            return .applied;
        }
    };

    var fake: Fake = .{};
    const cid = try @import("zat").Cid.forDagCbor(std.testing.allocator, "commit");
    defer std.testing.allocator.free(cid.raw);
    const result = try fake.store().apply(std.testing.allocator, .{ .delete = .{
        .record_uri = "at://did:plc:a/fm.plyr.dev.list/r",
        .owner_did = "did:plc:a",
        .collection = "fm.plyr.dev.list",
        .rkey = "r",
        .proof = .{
            .commit_cid = cid,
            .commit_rev = "3jqfcqzm3fo2j",
            .indexed_at_us = 1,
        },
    } });
    try std.testing.expectEqual(ApplyResult.applied, result);
    try std.testing.expectEqual(@as(usize, 1), fake.applied);
}
