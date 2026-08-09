const std = @import("std");
const zat = @import("zat");
const verified_list = @import("../domain/verified_list.zig");
const query = @import("../http/query.zig");
const scoped_record_cursor = @import("../identity/scoped_record_cursor.zig");
const store_module = @import("../index/verified_list_store.zig");
const VerifiedListStore = store_module.VerifiedListStore;

pub const default_limit: usize = 20;
pub const max_limit: usize = 100;
pub const cursor_prefix = "albcur_";

const Options = struct {
    limit: usize = default_limit,
    cursor: ?[]const u8 = null,
    artist_did: ?[]const u8 = null,
};

pub const Result = union(enum) {
    found: verified_list.Page,
    invalid_request,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?VerifiedListStore,
    list_collection: []const u8,
    profile_collection: []const u8,
    target: []const u8,
) Result {
    const options = parseOptions(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const artist_did = options.artist_did orelse return .invalid_request;
    if (zat.Did.parse(artist_did) == null) return .invalid_request;
    const scope = std.fmt.allocPrint(allocator, "artist:{s}", .{artist_did}) catch
        return .unavailable;

    const after: ?scoped_record_cursor.Cursor = if (options.cursor) |token| blk: {
        const storage = allocator.alloc(u8, token.len) catch return .unavailable;
        const decoded = scoped_record_cursor.decode(storage, cursor_prefix, scope, token) catch
            return .invalid_request;
        const parsed = zat.AtUri.parse(decoded.at_uri) orelse return .invalid_request;
        if (!std.mem.eql(u8, parsed.collection() orelse return .invalid_request, list_collection) or
            !std.mem.eql(u8, parsed.authority(), artist_did)) return .invalid_request;
        break :blk decoded;
    } else null;

    const configured = store orelse return .unavailable;
    const requested = options.limit + 1;
    const items = configured.listByOwner(allocator, .{
        .collection = list_collection,
        .profile_collection = profile_collection,
        .kind = .album,
        .owner_did = artist_did,
        .limit = requested,
        .after = after,
    }) catch |err| return classifyStoreError(err);
    if (items.len > requested) return .internal_error;

    const has_more = items.len > options.limit;
    const visible = items[0..@min(items.len, options.limit)];
    const data = allocator.alloc(verified_list.Summary, visible.len) catch return .unavailable;
    for (visible, data) |item, *destination| destination.* = item.value;
    const next_cursor = if (has_more and visible.len > 0)
        scoped_record_cursor.encode(allocator, cursor_prefix, scope, .{
            .created_at_us = visible[visible.len - 1].created_at_us,
            .at_uri = visible[visible.len - 1].value.record.uri,
        }) catch return .unavailable
    else
        null;
    return .{ .found = .{ .data = data, .has_more = has_more, .next_cursor = next_cursor } };
}

fn parseOptions(allocator: std.mem.Allocator, target: []const u8) !Options {
    var result: Options = .{};
    var saw_limit = false;
    var saw_cursor = false;
    var saw_artist = false;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "limit")) {
            if (saw_limit or pair.value.len == 0) return error.InvalidQuery;
            saw_limit = true;
            const parsed = std.fmt.parseInt(usize, pair.value, 10) catch return error.InvalidQuery;
            if (parsed < 1 or parsed > max_limit) return error.InvalidQuery;
            result.limit = parsed;
        } else if (std.mem.eql(u8, pair.name, "cursor")) {
            if (saw_cursor or pair.value.len == 0) return error.InvalidQuery;
            saw_cursor = true;
            result.cursor = pair.value;
        } else if (std.mem.eql(u8, pair.name, "artist_did")) {
            if (saw_artist or pair.value.len == 0) return error.InvalidQuery;
            saw_artist = true;
            result.artist_did = pair.value;
        } else return error.InvalidQuery;
    }
    return result;
}

fn classifyStoreError(err: VerifiedListStore.Error) Result {
    return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
}

test "album collection requires a canonical artist and requests verified albums" {
    const Fake = struct {
        fn store(self: *@This()) VerifiedListStore {
            return .{ .context = self, .list_by_owner_fn = list, .get_by_uri_fn = get };
        }
        fn list(
            _: *anyopaque,
            _: std.mem.Allocator,
            request: store_module.CollectionRequest,
        ) VerifiedListStore.Error![]store_module.CollectionItem {
            if (request.kind != .album or request.owner_did == null or
                !std.mem.eql(u8, request.owner_did.?, "did:plc:artist") or
                !std.mem.eql(u8, request.profile_collection, "fm.plyr.dev.actor.profile"))
                return error.CorruptProjection;
            return &.{};
        }
        fn get(
            _: *anyopaque,
            _: std.mem.Allocator,
            _: store_module.DetailRequest,
        ) VerifiedListStore.Error!?verified_list.Detail {
            return null;
        }
    };
    var fake: Fake = .{};
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    try std.testing.expectEqual(
        Result.invalid_request,
        execute(
            arena.allocator(),
            fake.store(),
            "fm.plyr.dev.list",
            "fm.plyr.dev.actor.profile",
            "/v1/albums",
        ),
    );
    const result = execute(
        arena.allocator(),
        fake.store(),
        "fm.plyr.dev.list",
        "fm.plyr.dev.actor.profile",
        "/v1/albums?artist_did=did%3Aplc%3Aartist",
    );
    try std.testing.expectEqual(@as(usize, 0), result.found.data.len);
}

test "album collection cursor is bound to the canonical artist scope" {
    const uri = "at://did:plc:other/fm.plyr.dev.list/album";
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const cursor = scoped_record_cursor.encode(
        arena.allocator(),
        cursor_prefix,
        "artist:did:plc:other",
        .{ .created_at_us = 42, .at_uri = uri },
    ) catch unreachable;
    const target = std.fmt.allocPrint(
        arena.allocator(),
        "/v1/albums?artist_did=did:plc:artist&cursor={s}",
        .{cursor},
    ) catch unreachable;
    try std.testing.expectEqual(
        Result.invalid_request,
        execute(
            arena.allocator(),
            null,
            "fm.plyr.dev.list",
            "fm.plyr.dev.actor.profile",
            target,
        ),
    );
}
