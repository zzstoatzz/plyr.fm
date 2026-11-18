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
    /// Whether the artist opted in to comments on their tracks. Off unless they did.
    comments_enabled_fn: *const fn (*anyopaque, artist_did: []const u8) Error!bool,

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

    pub fn commentsEnabled(self: CommentQueryStore, artist_did: []const u8) Error!bool {
        return self.comments_enabled_fn(self.context, artist_did);
    }
};
