//! PDS-first track likes.
//!
//! A successful command means the listener's PDS accepted the record. Postgres
//! keeps only the stable record key needed to replay an uncertain `putRecord`;
//! the like itself becomes readable when the verified repository index sees it.

const std = @import("std");
const zat = @import("zat");
const authenticated_pds = @import("authenticated_pds.zig");
const bearer = @import("../auth/bearer_token.zig");
const pds_gateway = @import("../auth/pds_gateway.zig");
const repo_scope = @import("../auth/repo_scope.zig");
const lexicon_value = @import("../atproto/lexicon_value.zig");
const key_store = @import("../command/record_key_store.zig");
const track_id = @import("../identity/track_id.zig");
const verified_track_subject = @import("verified_track_subject.zig");
const LikeQueryStore = @import("../index/like_query_store.zig").LikeQueryStore;
const TrackStore = @import("../index/track_store.zig").TrackStore;

const put_record = "com.atproto.repo.putRecord";

pub const Candidate = struct {
    rkey: []const u8,
    created_at: []const u8,
};

pub const Result = enum {
    liked,
    already_liked,
    invalid_id,
    not_found,
    unverified_target,
    session_unavailable,
    insufficient_scope,
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
    candidate: Candidate,
) Result {
    if (zat.Did.parse(actor_did) == null or zat.Nsid.parse(like_collection) == null)
        return .unavailable;
    if (!repo_scope.allows(granted_scope, like_collection, &.{ .create, .update }))
        return .insufficient_scope;
    if (zat.Tid.parse(candidate.rkey) == null or !lexicon_value.validDatetime(candidate.created_at))
        return .unavailable;

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
    const existing = like_index.listRecordKeys(allocator, .{
        .actor_did = actor_did,
        .subject_uri = subject.uri,
        .subject_cid = subject.cid,
        .like_collection = like_collection,
    }) catch |err| return switch (err) {
        error.CorruptProjection => Result.unverified_target,
        error.IndexUnavailable, error.OutOfMemory => Result.unavailable,
    };
    if (existing.len != 0) return .already_liked;

    const store = keys orelse return .unavailable;
    const operation_digest = key_store.digest(&.{ subject.uri, subject.cid });
    var reservation = store.reserve(allocator, .{
        .actor_did = actor_did,
        .collection = like_collection,
        .operation_digest = operation_digest,
        .rkey = candidate.rkey,
        .created_at = candidate.created_at,
    }) catch return .unavailable;
    defer reservation.deinit(allocator);

    const payload = std.json.Stringify.valueAlloc(allocator, .{
        .repo = actor_did,
        .collection = like_collection,
        .rkey = reservation.rkey,
        .record = .{
            .@"$type" = like_collection,
            .subject = .{ .uri = subject.uri, .cid = subject.cid },
            .createdAt = reservation.created_at,
        },
    }, .{}) catch return .unavailable;
    defer allocator.free(payload);

    const client = pds orelse return .unavailable;
    var response = client.execute(
        allocator,
        session_digest,
        .POST,
        put_record,
        payload,
    ) catch |err| return classifyCommandError(err);
    defer response.deinit(allocator);
    if (response.status == .unauthorized) return .session_unavailable;
    if (response.status != .ok) {
        return if (@intFromEnum(response.status) >= 500) .unavailable else .rejected;
    }
    validateResponse(allocator, response.body, actor_did, like_collection, reservation.rkey) catch
        return .invalid_pds_response;
    return .liked;
}

fn classifyCommandError(err: anyerror) Result {
    return switch (err) {
        error.SessionUnavailable, error.CorruptCredentials => .session_unavailable,
        else => .unavailable,
    };
}

fn validateResponse(
    allocator: std.mem.Allocator,
    body: []const u8,
    actor_did: []const u8,
    collection: []const u8,
    rkey: []const u8,
) !void {
    const parsed = try std.json.parseFromSliceLeaky(std.json.Value, allocator, body, .{});
    if (parsed != .object) return error.InvalidResponse;
    const uri = parsed.object.get("uri") orelse return error.InvalidResponse;
    const cid = parsed.object.get("cid") orelse return error.InvalidResponse;
    if (uri != .string or cid != .string) return error.InvalidResponse;
    const record_uri = zat.AtUri.parse(uri.string) orelse return error.InvalidResponse;
    if (!std.mem.eql(u8, record_uri.authority(), actor_did) or
        !std.mem.eql(u8, record_uri.collection() orelse return error.InvalidResponse, collection) or
        !std.mem.eql(u8, record_uri.rkey() orelse return error.InvalidResponse, rkey))
        return error.InvalidResponse;
    const parsed_cid = try zat.Cid.fromString(allocator, cid.string);
    defer allocator.free(parsed_cid.raw);
    if (parsed_cid.codec() != zat.cbor.Codec.dag_cbor) return error.InvalidResponse;
}

const track_fixture = @import("../testing/verified_track_store.zig");

const FakeKeys = struct {
    calls: usize = 0,
    reserved_rkey: []const u8,
    reserved_created_at: []const u8,

    fn store(self: *FakeKeys) key_store.Store {
        return .{
            .context = self,
            .reserve_fn = reserve,
            .get_fn = get,
            .release_fn = release,
        };
    }

    fn reserve(context: *anyopaque, allocator: std.mem.Allocator, _: key_store.Candidate) !key_store.Reservation {
        const self: *FakeKeys = @ptrCast(@alignCast(context));
        self.calls += 1;
        return .{
            .rkey = try allocator.dupe(u8, self.reserved_rkey),
            .created_at = try allocator.dupe(u8, self.reserved_created_at),
        };
    }

    fn get(_: *anyopaque, _: std.mem.Allocator, _: key_store.Key) !?key_store.Reservation {
        return null;
    }

    fn release(_: *anyopaque, _: key_store.Key, _: []const u8) !bool {
        return false;
    }
};

const FakeLikes = struct {
    calls: usize = 0,
    existing_rkey: ?[]const u8 = null,

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
        self.calls += 1;
        const rkey = self.existing_rkey orelse return &.{};
        const result = allocator.alloc([]const u8, 1) catch return error.OutOfMemory;
        result[0] = allocator.dupe(u8, rkey) catch return error.OutOfMemory;
        return result;
    }
};

const FakePds = struct {
    calls: usize = 0,
    payload_verified: bool = false,
    status: std.http.Status = .ok,

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
        try std.testing.expectEqualStrings(put_record, procedure);
        self.calls += 1;
        const parsed = try std.json.parseFromSliceLeaky(
            std.json.Value,
            allocator,
            payload orelse return error.MissingPayload,
            .{},
        );
        try std.testing.expectEqualStrings(
            "3mstablekey22",
            parsed.object.get("rkey").?.string,
        );
        try std.testing.expectEqualStrings(
            "2026-08-13T03:04:05.000000Z",
            parsed.object.get("record").?.object.get("createdAt").?.string,
        );
        self.payload_verified = true;
        return .{
            .status = self.status,
            .body = try allocator.dupe(
                u8,
                "{\"uri\":\"at://did:plc:listener/fm.plyr.dev.like/3mstablekey22\",\"cid\":\"bafyreihdcss27ihlhmjofustbdvksrwyxnjj3hhk7azqs2626paka66c2a\"}",
            ),
            .pds_nonce = null,
        };
    }
};

test "like is one replay-safe PDS putRecord and never an optimistic content write" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var tracks = track_fixture.Fake{ .value = track_fixture.example() };
    var likes: FakeLikes = .{};
    var keys = FakeKeys{
        .reserved_rkey = "3mstablekey22",
        .reserved_created_at = "2026-08-13T03:04:05.000000Z",
    };
    var pds: FakePds = .{};
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, tracks.value.record.uri);

    const result = execute(
        allocator,
        tracks.store(),
        likes.store(),
        keys.store(),
        pds.client(),
        bearer.digest("session"),
        "did:plc:listener",
        "atproto repo:fm.plyr.dev.like?action=create&action=update",
        "fm.plyr.dev.track",
        "fm.plyr.dev.like",
        id,
        .{ .rkey = "3mcandidate22", .created_at = "2026-08-13T03:04:06Z" },
    );
    try std.testing.expectEqual(Result.liked, result);
    try std.testing.expectEqual(@as(usize, 1), keys.calls);
    try std.testing.expectEqual(@as(usize, 1), likes.calls);
    try std.testing.expectEqual(@as(usize, 1), pds.calls);
    try std.testing.expect(pds.payload_verified);
}

test "like refuses an unverified target before reserving a key or calling a PDS" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var value = track_fixture.example();
    value.projection.verification = .legacy_unverified;
    var tracks = track_fixture.Fake{ .value = value };
    var likes: FakeLikes = .{};
    var keys = FakeKeys{
        .reserved_rkey = "3mstablekey22",
        .reserved_created_at = "2026-08-13T03:04:05Z",
    };
    var pds: FakePds = .{};
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, value.record.uri);

    try std.testing.expectEqual(Result.unverified_target, execute(
        arena.allocator(),
        tracks.store(),
        likes.store(),
        keys.store(),
        pds.client(),
        bearer.digest("session"),
        "did:plc:listener",
        "atproto repo:fm.plyr.dev.like?action=create&action=update",
        "fm.plyr.dev.track",
        "fm.plyr.dev.like",
        id,
        .{ .rkey = "3mcandidate22", .created_at = "2026-08-13T03:04:06Z" },
    ));
    try std.testing.expectEqual(@as(usize, 0), keys.calls);
    try std.testing.expectEqual(@as(usize, 0), likes.calls);
    try std.testing.expectEqual(@as(usize, 0), pds.calls);
}

test "like refuses a legacy broad grant before touching operational state" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var tracks = track_fixture.Fake{ .value = track_fixture.example() };
    var likes: FakeLikes = .{};
    var keys = FakeKeys{
        .reserved_rkey = "3mstablekey22",
        .reserved_created_at = "2026-08-13T03:04:05Z",
    };
    var pds: FakePds = .{};
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, tracks.value.record.uri);

    try std.testing.expectEqual(Result.insufficient_scope, execute(
        arena.allocator(),
        tracks.store(),
        likes.store(),
        keys.store(),
        pds.client(),
        bearer.digest("session"),
        "did:plc:listener",
        "atproto transition:generic",
        "fm.plyr.dev.track",
        "fm.plyr.dev.like",
        id,
        .{ .rkey = "3mcandidate22", .created_at = "2026-08-13T03:04:06Z" },
    ));
    try std.testing.expectEqual(@as(usize, 0), keys.calls);
    try std.testing.expectEqual(@as(usize, 0), likes.calls);
    try std.testing.expectEqual(@as(usize, 0), pds.calls);
}

test "like adopts an existing verified record without creating a duplicate" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    var tracks = track_fixture.Fake{ .value = track_fixture.example() };
    var likes = FakeLikes{ .existing_rkey = "3mlegacykey22" };
    var keys = FakeKeys{
        .reserved_rkey = "3mstablekey22",
        .reserved_created_at = "2026-08-13T03:04:05Z",
    };
    var pds: FakePds = .{};
    var id_buffer: [256]u8 = undefined;
    const id = try track_id.encode(&id_buffer, tracks.value.record.uri);

    try std.testing.expectEqual(Result.already_liked, execute(
        arena.allocator(),
        tracks.store(),
        likes.store(),
        keys.store(),
        pds.client(),
        bearer.digest("session"),
        "did:plc:listener",
        "atproto repo:fm.plyr.dev.like?action=create&action=update",
        "fm.plyr.dev.track",
        "fm.plyr.dev.like",
        id,
        .{ .rkey = "3mcandidate22", .created_at = "2026-08-13T03:04:06Z" },
    ));
    try std.testing.expectEqual(@as(usize, 1), likes.calls);
    try std.testing.expectEqual(@as(usize, 0), keys.calls);
    try std.testing.expectEqual(@as(usize, 0), pds.calls);
}
