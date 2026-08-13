//! Read port for resolving one viewer's exact-subject like state in batches.

const std = @import("std");

pub const Subject = struct {
    uri: []const u8,
    cid: []const u8,
};

pub const Request = struct {
    actor_did: []const u8,
    like_collection: []const u8,
    subjects: []const Subject,
};

pub const Store = struct {
    context: *anyopaque,
    resolve_fn: *const fn (*anyopaque, std.mem.Allocator, Request) Error![]const bool,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn resolve(
        self: Store,
        allocator: std.mem.Allocator,
        request: Request,
    ) Error![]const bool {
        return self.resolve_fn(self.context, allocator, request);
    }
};
