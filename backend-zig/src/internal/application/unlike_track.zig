//! PDS-first track unlikes.
//!
//! The verified index identifies every exact-subject record owned by the
//! listener. Each idempotent `deleteRecord` is acknowledged by the PDS before
//! success; projection lag is reported explicitly by the HTTP receipt.

const std = @import("std");
const zat = @import("zat");
const authenticated_pds = @import("authenticated_pds.zig");
const verified_track_subject = @import("verified_track_subject.zig");
const bearer = @import("../auth/bearer_token.zig");
const pds_gateway = @import("../auth/pds_gateway.zig");
const repo_scope = @import("../auth/repo_scope.zig");
const key_store = @import("../command/record_key_store.zig");
const LikeQueryStore = @import("../index/like_query_store.zig").LikeQueryStore;
const TrackStore = @import("../index/track_store.zig").TrackStore;

const delete_record = "com.atproto.repo.deleteRecord";
const maximum_duplicate_likes = 32;

const DeleteResult = enum {
    accepted,
    session_unavailable,
    rejected,
    invalid_response,
    unavailable,
};

pub const Result = union(enum) {
    unliked: usize,
    already_unliked,
    invalid_id,
    not_found,
    unverified_target,
    session_unavailable,
    insufficient_scope,
    too_many_records,
    rejected,
    invalid_pds_response,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    tracks: ?TrackStore,
    likes: ?LikeQueryStore,
    keys: ?key_store.Store,
    pds: ?authenticated_pds.Client,
    session_digest: bearer.Digest,
    actor_did: []const u8,
    granted_scope: []const u8,
    track_collection: []const u8,
    like_collection: []const u8,
    id: []const u8,
) Result {
    if (zat.Did.parse(actor_did) == null or zat.Nsid.parse(like_collection) == null)
        return .unavailable;
    if (!repo_scope.allows(granted_scope, like_collection, &.{.delete}))
        return .insufficient_scope;
    const subject = switch (verified_track_subject.resolve(
        allocator,
        tracks,
        track_collection,
        id,
    )) {
        .found => |value| value,
        .invalid_id => return .invalid_id,
        .not_found => return .not_found,
        .unverified => return .unverified_target,
        .unavailable => return .unavailable,
    };
    const like_index = likes orelse return .unavailable;
    const rkeys = like_index.listRecordKeys(allocator, .{
        .actor_did = actor_did,
        .subject_uri = subject.uri,
        .subject_cid = subject.cid,
        .like_collection = like_collection,
    }) catch |err| return switch (err) {
        error.CorruptProjection => Result.unverified_target,
        error.IndexUnavailable, error.OutOfMemory => Result.unavailable,
    };
    if (rkeys.len == 0) return .already_unliked;
    if (rkeys.len > maximum_duplicate_likes) return .too_many_records;

    const client = pds orelse return .unavailable;
    const operation_digest = key_store.digest(&.{ subject.uri, subject.cid });
    for (rkeys) |rkey| {
        switch (deleteOne(
            allocator,
            client,
            session_digest,
            actor_did,
            like_collection,
            rkey,
        )) {
            .accepted => {},
            .session_unavailable => return .session_unavailable,
            .rejected => return .rejected,
            .invalid_response => return .invalid_pds_response,
            .unavailable => return .unavailable,
        }
        if (keys) |store| {
            _ = store.release(.{
                .actor_did = actor_did,
                .collection = like_collection,
                .operation_digest = operation_digest,
            }, rkey) catch |err| {
                std.log.warn("accepted PDS unlike key cleanup failed: {}", .{err});
            };
        }
    }
    return .{ .unliked = rkeys.len };
}

fn deleteOne(
    allocator: std.mem.Allocator,
    client: authenticated_pds.Client,
    session_digest: bearer.Digest,
    actor_did: []const u8,
    like_collection: []const u8,
    rkey: []const u8,
) DeleteResult {
    const payload = std.json.Stringify.valueAlloc(allocator, .{
        .repo = actor_did,
        .collection = like_collection,
        .rkey = rkey,
    }, .{}) catch return .unavailable;
    defer allocator.free(payload);
    var response = client.execute(
        allocator,
        session_digest,
        .POST,
        delete_record,
        payload,
    ) catch |err| return classifyCommandError(err);
    defer response.deinit(allocator);
    if (response.status == .unauthorized) return .session_unavailable;
    if (response.status != .ok)
        return if (@intFromEnum(response.status) >= 500) .unavailable else .rejected;
    validateResponse(allocator, response.body) catch return .invalid_response;
    return .accepted;
}

fn classifyCommandError(err: anyerror) DeleteResult {
    return switch (err) {
        error.SessionUnavailable, error.CorruptCredentials => .session_unavailable,
        else => .unavailable,
    };
}

fn validateResponse(allocator: std.mem.Allocator, body: []const u8) !void {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, body, .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidResponse;
    const commit = parsed.value.object.get("commit") orelse return;
    if (commit != .object) return error.InvalidResponse;
    const cid = commit.object.get("cid") orelse return error.InvalidResponse;
    const rev = commit.object.get("rev") orelse return error.InvalidResponse;
    if (cid != .string or rev != .string or zat.Tid.parse(rev.string) == null)
        return error.InvalidResponse;
    const parsed_cid = try zat.Cid.fromString(allocator, cid.string);
    defer allocator.free(parsed_cid.raw);
    if (parsed_cid.codec() != zat.cbor.Codec.dag_cbor) return error.InvalidResponse;
}

const track_id = @import("../identity/track_id.zig");
const track_fixture = @import("../testing/verified_track_store.zig");

const FakeLikes = struct {
    rkeys: []const []const u8,

    fn store(self: *FakeLikes) LikeQueryStore {
        return .{
            .context = self,
            .list_by_subject_fn = list,
            .list_record_keys_fn = listRecordKeys,
        };
    }

    fn list(
        _: *anyopaque,
        _: std.mem.Allocator,
        _: @import("../index/like_query_store.zig").SubjectRequest,
    ) LikeQueryStore.Error![]@import("../index/like_query_store.zig").Item {
        return &.{};
    }

    fn listRecordKeys(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        _: @import("../index/like_query_store.zig").ActorSubjectRequest,
    ) LikeQueryStore.Error![]const []const u8 {
        const self: *FakeLikes = @ptrCast(@alignCast(context));
        const result = allocator.alloc([]const u8, self.rkeys.len) catch return error.OutOfMemory;
        for (self.rkeys, 0..) |rkey, index|
            result[index] = allocator.dupe(u8, rkey) catch return error.OutOfMemory;
        return result;
    }
};

const FakeKeys = struct {
    releases: usize = 0,

    fn store(self: *FakeKeys) key_store.Store {
        return .{
            .context = self,
            .reserve_fn = reserve,
            .get_fn = get,
            .release_fn = release,
        };
    }

    fn reserve(_: *anyopaque, _: std.mem.Allocator, _: key_store.Candidate) !key_store.Reservation {
        return error.UnexpectedReserve;
    }

    fn get(_: *anyopaque, _: std.mem.Allocator, _: key_store.Key) !?key_store.Reservation {
        return null;
    }

    fn release(context: *anyopaque, _: key_store.Key, _: []const u8) !bool {
        const self: *FakeKeys = @ptrCast(@alignCast(context));
        self.releases += 1;
        return true;
    }
};

const FakePds = struct {
    expected: []const []const u8,
    calls: usize = 0,

    fn client(self: *FakePds) authenticated_pds.Client {
        return .{ .context = self, .execute_fn = run };
    }

    fn run(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        _: bearer.Digest,
        method: std.http.Method,
        procedure: []const u8,
        payload: ?[]const u8,
    ) !pds_gateway.Response {
        const self: *FakePds = @ptrCast(@alignCast(context));
        try std.testing.expectEqual(std.http.Method.POST, method);
        try std.testing.expectEqualStrings(delete_record, procedure);
        const parsed = try std.json.parseFromSliceLeaky(
            std.json.Value,
            allocator,
            payload orelse return error.MissingPayload,
            .{},
        );
        try std.testing.expectEqualStrings(
            self.expected[self.calls],
            parsed.object.get("rkey").?.string,
        );
        self.calls += 1;
        return .{
            .status = .ok,
            .body = try allocator.dupe(u8, "{}"),
            .pds_nonce = null,
        };
    }
};

test "unlike deletes every verified duplicate and releases only operational keys" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var tracks = track_fixture.Fake{ .value = track_fixture.example() };
    const rkeys = [_][]const u8{ "3mfirstlike22", "3msecondlik22" };
    var likes = FakeLikes{ .rkeys = &rkeys };
    var keys: FakeKeys = .{};
    var pds = FakePds{ .expected = &rkeys };
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, tracks.value.record.uri);

    const result = execute(
        arena.allocator(),
        tracks.store(),
        likes.store(),
        keys.store(),
        pds.client(),
        bearer.digest("session"),
        "did:plc:listener",
        "atproto repo:fm.plyr.dev.like?action=create&action=update&action=delete",
        "fm.plyr.dev.track",
        "fm.plyr.dev.like",
        id,
    );
    try std.testing.expectEqual(@as(usize, 2), result.unliked);
    try std.testing.expectEqual(@as(usize, 2), pds.calls);
    try std.testing.expectEqual(@as(usize, 2), keys.releases);
}

test "unlike is idempotent when the verified index has no record" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var tracks = track_fixture.Fake{ .value = track_fixture.example() };
    var likes = FakeLikes{ .rkeys = &.{} };
    var keys: FakeKeys = .{};
    var pds = FakePds{ .expected = &.{} };
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, tracks.value.record.uri);
    try std.testing.expectEqual(Result.already_unliked, execute(
        arena.allocator(),
        tracks.store(),
        likes.store(),
        keys.store(),
        pds.client(),
        bearer.digest("session"),
        "did:plc:listener",
        "atproto repo:fm.plyr.dev.like?action=delete",
        "fm.plyr.dev.track",
        "fm.plyr.dev.like",
        id,
    ));
    try std.testing.expectEqual(@as(usize, 0), pds.calls);
}
