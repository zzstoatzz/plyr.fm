//! Port for durable, source-authoritative comment-record projection.

const std = @import("std");
const comment_change = @import("comment_change.zig");

pub const ApplyResult = enum { applied, idempotent, stale };

pub const CommentStore = struct {
    context: *anyopaque,
    apply_fn: *const fn (*anyopaque, std.mem.Allocator, comment_change.Change) Error!ApplyResult,

    pub fn apply(
        self: CommentStore,
        allocator: std.mem.Allocator,
        change: comment_change.Change,
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
