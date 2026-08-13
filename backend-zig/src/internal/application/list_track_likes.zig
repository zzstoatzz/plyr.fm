const std = @import("std");
const like = @import("../domain/like.zig");
const query = @import("../http/query.zig");
const scoped_cursor = @import("../identity/scoped_record_cursor.zig");
const track_id = @import("../identity/track_id.zig");
const like_store_module = @import("../index/like_query_store.zig");
const track_store_module = @import("../index/track_store.zig");

const LikeQueryStore = like_store_module.LikeQueryStore;
const TrackStore = track_store_module.TrackStore;

pub const default_limit: usize = 20;
pub const max_limit: usize = 100;
pub const cursor_prefix = "likecur_";

const Options = struct {
    limit: usize = default_limit,
    cursor: ?[]const u8 = null,
};

pub const Result = union(enum) {
    found: like.Page,
    invalid_request,
    invalid_id,
    not_found,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    track_store: ?TrackStore,
    like_store: ?LikeQueryStore,
    track_collection: []const u8,
    like_collection: []const u8,
    profile_collection: []const u8,
    id: []const u8,
    target: []const u8,
) Result {
    const options = parseOptions(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const decoded = allocator.alloc(u8, id.len) catch return .unavailable;
    const uri = track_id.decode(decoded, id) catch return .invalid_id;
    const parsed = @import("zat").AtUri.parse(uri) orelse return .invalid_id;
    if (!std.mem.eql(u8, parsed.collection() orelse return .invalid_id, track_collection))
        return .not_found;

    const tracks = track_store orelse return .unavailable;
    const subject = tracks.getByUri(allocator, uri) catch |err|
        return classifyTrackError(err);
    const current = subject orelse return .not_found;
    if (current.projection.verification != .verified_repo) return .not_found;
    const subject_cid = current.record.cid orelse return .internal_error;

    const scope = std.fmt.allocPrint(allocator, "{s}\n{s}", .{ uri, subject_cid }) catch
        return .unavailable;
    const after: ?scoped_cursor.Cursor = if (options.cursor) |token| blk: {
        const storage = allocator.alloc(u8, token.len) catch return .unavailable;
        break :blk scoped_cursor.decode(storage, cursor_prefix, scope, token) catch
            return .invalid_request;
    } else null;

    const likes = like_store orelse return .unavailable;
    const requested = options.limit + 1;
    const items = likes.listBySubject(allocator, .{
        .subject_uri = uri,
        .subject_cid = subject_cid,
        .like_collection = like_collection,
        .profile_collection = profile_collection,
        .limit = requested,
        .after = after,
    }) catch |err| return classifyLikeError(err);
    if (items.len > requested) return .internal_error;

    const has_more = items.len > options.limit;
    const visible = items[0..@min(items.len, options.limit)];
    const data = allocator.alloc(like.Like, visible.len) catch return .unavailable;
    for (visible, data) |item, *destination| destination.* = item.value;
    const next_cursor = if (has_more and visible.len > 0)
        scoped_cursor.encode(allocator, cursor_prefix, scope, .{
            .created_at_us = visible[visible.len - 1].created_at_us,
            .at_uri = visible[visible.len - 1].value.record.uri,
        }) catch return .unavailable
    else
        null;
    return .{ .found = .{
        .data = data,
        .has_more = has_more,
        .next_cursor = next_cursor,
    } };
}

fn parseOptions(allocator: std.mem.Allocator, target: []const u8) !Options {
    var result: Options = .{};
    var saw_limit = false;
    var saw_cursor = false;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "limit")) {
            if (saw_limit or pair.value.len == 0) return error.InvalidQuery;
            saw_limit = true;
            result.limit = std.fmt.parseInt(usize, pair.value, 10) catch return error.InvalidQuery;
            if (result.limit < 1 or result.limit > max_limit) return error.InvalidQuery;
        } else if (std.mem.eql(u8, pair.name, "cursor")) {
            if (saw_cursor or pair.value.len == 0) return error.InvalidQuery;
            saw_cursor = true;
            result.cursor = pair.value;
        } else return error.InvalidQuery;
    }
    return result;
}

fn classifyTrackError(err: TrackStore.Error) Result {
    return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
}

fn classifyLikeError(err: LikeQueryStore.Error) Result {
    return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
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

const FakeLikes = struct {
    items: []like_store_module.Item,
    expected_cid: []const u8,

    fn store(self: *FakeLikes) LikeQueryStore {
        return .{
            .context = self,
            .list_by_subject_fn = list,
            .find_record_key_fn = findRecordKey,
        };
    }

    fn list(
        context: *anyopaque,
        _: std.mem.Allocator,
        request: like_store_module.SubjectRequest,
    ) LikeQueryStore.Error![]like_store_module.Item {
        const self: *FakeLikes = @ptrCast(@alignCast(context));
        if (!std.mem.eql(u8, request.subject_cid, self.expected_cid))
            return error.CorruptProjection;
        return self.items[0..@min(self.items.len, request.limit)];
    }

    fn findRecordKey(
        _: *anyopaque,
        _: std.mem.Allocator,
        _: like_store_module.ActorSubjectRequest,
    ) LikeQueryStore.Error!?[]const u8 {
        return null;
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

fn exampleLike(uri: []const u8) like.Like {
    return .{
        .record = .{
            .uri = uri,
            .cid = "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            .collection = "fm.plyr.dev.like",
            .rkey = "like",
        },
        .actor = .{ .did = "did:plc:listener", .profile = null },
        .subject = .{
            .uri = "at://did:plc:artist/fm.plyr.dev.track/song",
            .cid = "bafyreihdcss27ihlhmjofustbdvksrwyxnjj3hhk7azqs2626paka66c2a",
        },
        .created_at = "2026-08-09T00:00:00Z",
        .sources = .{
            .actor_profile = .derived,
            .account_availability = .verified_repo,
        },
        .projection = .{
            .commit_cid = "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            .commit_rev = "3m123rev",
            .indexed_at_us = 42,
        },
    };
}

test "track likes require a verified current subject and paginate exact-CID records" {
    const a = std.testing.allocator;
    const subject_cid = "bafyreihdcss27ihlhmjofustbdvksrwyxnjj3hhk7azqs2626paka66c2a";
    const uri_a = "at://did:plc:listener/fm.plyr.dev.like/a";
    const uri_b = "at://did:plc:listener/fm.plyr.dev.like/b";
    var items = [_]like_store_module.Item{
        .{ .value = exampleLike(uri_a), .created_at_us = 200 },
        .{ .value = exampleLike(uri_b), .created_at_us = 100 },
    };
    var tracks = FakeTracks{ .value = exampleTrack(subject_cid, .verified_repo) };
    var likes = FakeLikes{ .items = &items, .expected_cid = subject_cid };
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, tracks.value.?.record.uri);

    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const first = execute(
        arena.allocator(),
        tracks.store(),
        likes.store(),
        "fm.plyr.dev.track",
        "fm.plyr.dev.like",
        "fm.plyr.dev.actor.profile",
        id,
        "/v1/tracks/x/likes?limit=1",
    );
    try std.testing.expectEqual(@as(usize, 1), first.found.data.len);
    try std.testing.expect(first.found.has_more);
    try std.testing.expect(first.found.next_cursor != null);
}

test "track likes reject legacy subjects and strict query violations" {
    const a = std.testing.allocator;
    var arena = std.heap.ArenaAllocator.init(a);
    defer arena.deinit();
    const allocator = arena.allocator();
    var tracks = FakeTracks{ .value = exampleTrack(null, .legacy_unverified) };
    var likes = FakeLikes{ .items = &.{}, .expected_cid = "unused" };
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, tracks.value.?.record.uri);
    try std.testing.expectEqual(
        Result.not_found,
        execute(allocator, tracks.store(), likes.store(), "fm.plyr.dev.track", "fm.plyr.dev.like", "fm.plyr.dev.actor.profile", id, "/v1/tracks/x/likes"),
    );
    try std.testing.expectEqual(
        Result.invalid_request,
        execute(allocator, tracks.store(), likes.store(), "fm.plyr.dev.track", "fm.plyr.dev.like", "fm.plyr.dev.actor.profile", id, "/v1/tracks/x/likes?offset=1"),
    );
}
