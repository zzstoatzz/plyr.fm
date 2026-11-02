//! Where one record stands in the projection, for read-after-write.

const std = @import("std");

pub const State = enum { indexed, deleted, rejected };

pub const Status = struct {
    state: State,
    /// CID the projection holds (null for a tombstone).
    record_cid: ?[]const u8,
    /// Rejection reason, only for `rejected`.
    reason: ?[]const u8,
};

pub const RecordStatusStore = struct {
    context: *anyopaque,
    get_fn: *const fn (*anyopaque, std.mem.Allocator, []const u8) Error!?Status,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn get(
        self: RecordStatusStore,
        allocator: std.mem.Allocator,
        record_uri: []const u8,
    ) Error!?Status {
        return self.get_fn(self.context, allocator, record_uri);
    }
};
