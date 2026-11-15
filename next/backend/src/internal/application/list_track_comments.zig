//! A track's timed comments, in playback order, for the scrubber and the list.

const std = @import("std");
const comment = @import("../domain/comment.zig");
const query = @import("../http/query.zig");
const track_id = @import("../identity/track_id.zig");
const comment_store_module = @import("../index/comment_query_store.zig");
const track_store_module = @import("../index/track_store.zig");

const CommentQueryStore = comment_store_module.CommentQueryStore;
const TrackStore = track_store_module.TrackStore;

/// A busy mix can collect hundreds; the scrubber wants them all at once.
pub const default_limit: usize = 500;
pub const max_limit: usize = 1000;

pub const Result = union(enum) {
    found: comment.Page,
    invalid_request,
    invalid_id,
    not_found,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    track_store: ?TrackStore,
    comment_store: ?CommentQueryStore,
    track_collection: []const u8,
    comment_collection: []const u8,
    profile_collection: []const u8,
    id: []const u8,
    target: []const u8,
) Result {
    const limit = parseLimit(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const decoded = allocator.alloc(u8, id.len) catch return .unavailable;
    const uri = track_id.decode(decoded, id) catch return .invalid_id;
    const parsed = @import("zat").AtUri.parse(uri) orelse return .invalid_id;
    if (!std.mem.eql(u8, parsed.collection() orelse return .invalid_id, track_collection))
        return .not_found;

    const tracks = track_store orelse return .unavailable;
    const subject = tracks.getByUri(allocator, uri) catch |err| return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
    const current = subject orelse return .not_found;
    if (current.projection.verification != .verified_repo) return .not_found;

    const comments = comment_store orelse return .unavailable;
    const items = comments.listBySubject(allocator, .{
        .subject_uri = uri,
        .comment_collection = comment_collection,
        .profile_collection = profile_collection,
        .limit = limit + 1,
    }) catch |err| return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
    if (items.len > limit + 1) return .internal_error;
    return .{ .found = .{
        .data = items[0..@min(items.len, limit)],
        .has_more = items.len > limit,
    } };
}

fn parseLimit(allocator: std.mem.Allocator, target: []const u8) !usize {
    var limit: usize = default_limit;
    var saw_limit = false;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (!std.mem.eql(u8, pair.name, "limit") or saw_limit or pair.value.len == 0)
            return error.InvalidQuery;
        saw_limit = true;
        limit = query.parseDecimal(usize, pair.value) catch return error.InvalidQuery;
        if (limit < 1 or limit > max_limit) return error.InvalidQuery;
    }
    return limit;
}

const FakeTracks = struct {
    value: ?@import("../domain/track.zig").Track,

    fn store(self: *FakeTracks) TrackStore {
        return .{
            .context = self,
            .get_by_uri_fn = get,
            .list_public_fn = list,
            .ready_fn = ready,
        };
    }

    fn get(
        context: *anyopaque,
        _: std.mem.Allocator,
        _: []const u8,
    ) TrackStore.Error!?@import("../domain/track.zig").Track {
        const self: *FakeTracks = @ptrCast(@alignCast(context));
        return self.value;
    }

    fn list(
        _: *anyopaque,
        _: std.mem.Allocator,
        _: track_store_module.ListRequest,
    ) TrackStore.Error![]track_store_module.ListItem {
        return &.{};
    }

    fn ready(_: *anyopaque) bool {
        return true;
    }
};

const FakeComments = struct {
    items: []const comment.Comment,
    asked: ?comment_store_module.SubjectRequest = null,

    fn store(self: *FakeComments) CommentQueryStore {
        return .{ .context = self, .list_by_subject_fn = list };
    }

    fn list(
        context: *anyopaque,
        _: std.mem.Allocator,
        request: comment_store_module.SubjectRequest,
    ) CommentQueryStore.Error![]comment.Comment {
        const self: *FakeComments = @ptrCast(@alignCast(context));
        self.asked = request;
        return @constCast(self.items[0..@min(self.items.len, request.limit)]);
    }
};

fn exampleTrack(cid: ?[]const u8, verification: @import("../domain/track.zig").ProjectionVerification) @import("../domain/track.zig").Track {
    return .{
        .id = "trk_example",
        .record = .{
            .uri = "at://did:plc:artist/fm.plyr.dev.track/song",
            .cid = cid,
            .revision = "3m123rev",
            .collection = "fm.plyr.dev.track",
            .rkey = "song",
        },
        .metadata = .{
            .title = "Song",
            .description = null,
            .album = null,
            .duration_seconds = null,
            .created_at = "2026-08-09T00:00:00Z",
        },
        .artist = .{
            .did = "did:plc:artist",
            .profile = .{ .handle = "artist.test", .display_name = "Artist", .avatar_url = null },
        },
        .media = .{ .artifacts = &.{}, .origins = &.{} },
        .access = .{ .visibility = .public, .in_discovery = true, .gate = null, .space_uri = null },
        .moderation = .{ .self_labels = &.{}, .operator_labels = &.{}, .override = null },
        .metrics = .{ .play_count = 0 },
        .projection = .{ .indexed_at = null, .verification = verification },
    };
}

fn exampleComment(ms: i64) comment.Comment {
    return .{
        .record = .{ .uri = "at://did:plc:listener/fm.plyr.dev.comment/c", .cid = "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", .rkey = "c" },
        .author = .{ .did = "did:plc:listener", .handle = "listener.test", .display_name = "Listener", .avatar_url = null },
        .subject = .{ .uri = "at://did:plc:artist/fm.plyr.dev.track/song", .cid = "bafyreihdcss27ihlhmjofustbdvksrwyxnjj3hhk7azqs2626paka66c2a" },
        .text = "the sax here",
        .timestamp_ms = ms,
        .created_at = "2026-11-14T09:00:00Z",
        .updated_at = null,
    };
}

test "track comments read every version of a verified track and report more" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var tracks = FakeTracks{ .value = exampleTrack("bafyreihdcss27ihlhmjofustbdvksrwyxnjj3hhk7azqs2626paka66c2a", .verified_repo) };
    const items = [_]comment.Comment{ exampleComment(42_000), exampleComment(250_000), exampleComment(260_000) };
    var comments = FakeComments{ .items = &items };
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, tracks.value.?.record.uri);
    const all = execute(a, tracks.store(), comments.store(), "fm.plyr.dev.track", "fm.plyr.dev.comment", "fm.plyr.dev.actor.profile", id, "/v1/tracks/x/comments");
    try std.testing.expectEqual(@as(usize, 3), all.found.data.len);
    try std.testing.expect(!all.found.has_more);
    try std.testing.expectEqualStrings("at://did:plc:artist/fm.plyr.dev.track/song", comments.asked.?.subject_uri);
    const two = execute(a, tracks.store(), comments.store(), "fm.plyr.dev.track", "fm.plyr.dev.comment", "fm.plyr.dev.actor.profile", id, "/v1/tracks/x/comments?limit=2");
    try std.testing.expectEqual(@as(usize, 2), two.found.data.len);
    try std.testing.expect(two.found.has_more);
}

test "track comments reject legacy tracks and unknown query parameters" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    var tracks = FakeTracks{ .value = exampleTrack(null, .legacy_unverified) };
    var comments = FakeComments{ .items = &.{} };
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, tracks.value.?.record.uri);
    try std.testing.expectEqual(Result.not_found, execute(a, tracks.store(), comments.store(), "fm.plyr.dev.track", "fm.plyr.dev.comment", "fm.plyr.dev.actor.profile", id, "/v1/tracks/x/comments"));
    try std.testing.expectEqual(Result.invalid_request, execute(a, tracks.store(), comments.store(), "fm.plyr.dev.track", "fm.plyr.dev.comment", "fm.plyr.dev.actor.profile", id, "/v1/tracks/x/comments?cursor=a"));
    try std.testing.expectEqual(Result.invalid_request, execute(a, tracks.store(), comments.store(), "fm.plyr.dev.track", "fm.plyr.dev.comment", "fm.plyr.dev.actor.profile", id, "/v1/tracks/x/comments?limit=0"));
}
