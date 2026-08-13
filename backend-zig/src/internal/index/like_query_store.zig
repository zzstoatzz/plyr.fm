//! Read port for source-authenticated interaction projections.

const std = @import("std");
const like = @import("../domain/like.zig");
const scoped_record_cursor = @import("../identity/scoped_record_cursor.zig");

pub const SubjectRequest = struct {
    subject_uri: []const u8,
    subject_cid: []const u8,
    like_collection: []const u8,
    profile_collection: []const u8,
    limit: usize,
    after: ?scoped_record_cursor.Cursor,
};

pub const ActorSubjectRequest = struct {
    actor_did: []const u8,
    subject_uri: []const u8,
    subject_cid: []const u8,
    like_collection: []const u8,
};

pub const Item = struct {
    value: like.Like,
    created_at_us: i64,
};

pub const LikeQueryStore = struct {
    context: *anyopaque,
    list_by_subject_fn: *const fn (*anyopaque, std.mem.Allocator, SubjectRequest) Error![]Item,
    find_record_key_fn: *const fn (*anyopaque, std.mem.Allocator, ActorSubjectRequest) Error!?[]const u8,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn listBySubject(
        self: LikeQueryStore,
        allocator: std.mem.Allocator,
        request: SubjectRequest,
    ) Error![]Item {
        return self.list_by_subject_fn(self.context, allocator, request);
    }

    pub fn findRecordKey(
        self: LikeQueryStore,
        allocator: std.mem.Allocator,
        request: ActorSubjectRequest,
    ) Error!?[]const u8 {
        return self.find_record_key_fn(self.context, allocator, request);
    }
};
