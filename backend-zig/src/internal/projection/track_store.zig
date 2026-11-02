//! Port for durable, source-authoritative track record projection.

const std = @import("std");
const track_change = @import("track_change.zig");

pub const ApplyResult = enum { applied, idempotent, stale };

pub const TrackStore = struct {
    context: *anyopaque,
    apply_fn: *const fn (*anyopaque, std.mem.Allocator, track_change.Change) Error!ApplyResult,

    pub fn apply(
        self: TrackStore,
        allocator: std.mem.Allocator,
        change: track_change.Change,
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
