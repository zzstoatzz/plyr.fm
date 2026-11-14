//! Read port for a track's timed comments, in playback order.

const std = @import("std");
const comment = @import("../domain/comment.zig");

pub const SubjectRequest = struct {
    /// every version of the track: an edit changes its CID, not where people commented
    subject_uri: []const u8,
    comment_collection: []const u8,
    profile_collection: []const u8,
    limit: usize,
};

pub const CommentQueryStore = struct {
    context: *anyopaque,
    list_by_subject_fn: *const fn (*anyopaque, std.mem.Allocator, SubjectRequest) Error![]comment.Comment,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn listBySubject(
        self: CommentQueryStore,
        allocator: std.mem.Allocator,
        request: SubjectRequest,
    ) Error![]comment.Comment {
        return self.list_by_subject_fn(self.context, allocator, request);
    }
};
