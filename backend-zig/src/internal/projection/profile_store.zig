//! Port for durable, source-authoritative authored profile projection.

const std = @import("std");
const profile_change = @import("profile_change.zig");

pub const ApplyResult = enum { applied, idempotent, stale };

pub const ProfileStore = struct {
    context: *anyopaque,
    apply_fn: *const fn (*anyopaque, std.mem.Allocator, profile_change.Change) Error!ApplyResult,

    pub fn apply(
        self: ProfileStore,
        allocator: std.mem.Allocator,
        change: profile_change.Change,
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
