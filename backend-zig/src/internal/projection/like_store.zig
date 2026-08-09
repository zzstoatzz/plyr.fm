//! Port for durable, source-authoritative like-record projection.

const std = @import("std");
const like_change = @import("like_change.zig");

pub const ApplyResult = enum { applied, idempotent, stale };

pub const LikeStore = struct {
    context: *anyopaque,
    apply_fn: *const fn (*anyopaque, std.mem.Allocator, like_change.Change) Error!ApplyResult,

    pub fn apply(
        self: LikeStore,
        allocator: std.mem.Allocator,
        change: like_change.Change,
    ) Error!ApplyResult {
        return self.apply_fn(self.context, allocator, change);
    }

    pub const Error = error{
        RevisionConflict,
        CorruptProjection,
        ProjectionUnavailable,
        OutOfMemory,
    };
};
