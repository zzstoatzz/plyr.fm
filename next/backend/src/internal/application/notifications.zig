//! An account's notifications, shaped like the other atproto notification
//! APIs (Bluesky's, Grain's): newest first, keyset-paged, and read through
//! one `seenAt` watermark the account advances.

const std = @import("std");
const zat = @import("zat");
const query = @import("../http/query.zig");
const lexicon_value = @import("../atproto/lexicon_value.zig");
const scoped_cursor = @import("../identity/scoped_record_cursor.zig");
const store_module = @import("../notification/store.zig");

const NotificationStore = store_module.NotificationStore;

pub const default_limit: usize = 50;
pub const max_limit: usize = 100;
pub const cursor_prefix = "notecur_";
/// microseconds of 9999-12-31T23:59:59.999999Z, the last instant
/// `zat.Datetime` renders in four year digits
const last_renderable_us: i64 = 253_402_300_799_999_999;

pub const Author = struct {
    did: []const u8,
    handle: ?[]const u8 = null,
    displayName: ?[]const u8 = null,
    avatar: ?[]const u8 = null,
};

pub const Subject = struct {
    uri: []const u8,
    title: []const u8,
};

pub const Notification = struct {
    uri: []const u8,
    cid: []const u8,
    author: Author,
    /// `like` | `feature`
    reason: []const u8,
    /// the recipient's liked track, or the track that features them
    reasonSubject: []const u8,
    subject: Subject,
    isRead: bool,
    /// the causing record's own createdAt
    createdAt: []const u8,
    /// the instant plyr orders and reads by
    indexedAt: []const u8,
};

pub const Page = struct {
    notifications: []const Notification,
    cursor: ?[]const u8 = null,
    seenAt: ?[]const u8 = null,
};

pub const ListResult = union(enum) {
    found: Page,
    invalid_request,
    internal_error,
    unavailable,
};

pub const CountResult = union(enum) {
    found: i64,
    internal_error,
    unavailable,
};

pub const SeenResult = union(enum) {
    updated,
    invalid_request,
    internal_error,
    unavailable,
};

const Options = struct {
    limit: usize = default_limit,
    cursor: ?[]const u8 = null,
};

pub fn list(
    allocator: std.mem.Allocator,
    store: ?NotificationStore,
    recipient_did: []const u8,
    collections: store_module.Collections,
    target: []const u8,
) ListResult {
    const options = parseOptions(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    // a cursor belongs to one recipient: it cannot page someone else's inbox
    const before: ?scoped_cursor.Cursor = if (options.cursor) |token| blk: {
        const storage = allocator.alloc(u8, token.len) catch return .unavailable;
        break :blk scoped_cursor.decode(storage, cursor_prefix, recipient_did, token) catch
            return .invalid_request;
    } else null;

    const notifications = store orelse return .unavailable;
    const seen_at_us = notifications.seenAt(recipient_did) catch |err| return classify(ListResult, err);
    const requested = options.limit + 1;
    const items = notifications.list(allocator, .{
        .recipient_did = recipient_did,
        .collections = collections,
        .limit = requested,
        .before = before,
    }) catch |err| return classify(ListResult, err);
    if (items.len > requested) return .internal_error;

    const has_more = items.len > options.limit;
    const visible = items[0..@min(items.len, options.limit)];
    const data = allocator.alloc(Notification, visible.len) catch return .unavailable;
    for (visible, data) |item, *destination| {
        destination.* = .{
            .uri = item.uri,
            .cid = item.cid,
            .author = .{
                .did = item.author.did,
                .handle = item.author.handle,
                .displayName = item.author.display_name,
                .avatar = item.author.avatar,
            },
            .reason = @tagName(item.reason),
            .reasonSubject = item.subject_uri,
            .subject = .{ .uri = item.subject_uri, .title = item.subject_title },
            .isRead = if (seen_at_us) |seen| item.sort_at_us <= seen else false,
            .createdAt = item.created_at,
            .indexedAt = (datetime(allocator, item.sort_at_us) catch return .unavailable) orelse
                return .internal_error,
        };
    }
    const next_cursor = if (has_more and visible.len > 0)
        scoped_cursor.encode(allocator, cursor_prefix, recipient_did, .{
            .created_at_us = visible[visible.len - 1].sort_at_us,
            .at_uri = visible[visible.len - 1].uri,
        }) catch return .internal_error
    else
        null;
    const seen_at = if (seen_at_us) |seen|
        (datetime(allocator, seen) catch return .unavailable) orelse return .internal_error
    else
        null;
    return .{ .found = .{ .notifications = data, .cursor = next_cursor, .seenAt = seen_at } };
}

pub fn unreadCount(
    store: ?NotificationStore,
    recipient_did: []const u8,
    collections: store_module.Collections,
) CountResult {
    const notifications = store orelse return .unavailable;
    const seen_at_us = notifications.seenAt(recipient_did) catch |err| return classify(CountResult, err);
    const count = notifications.countUnread(recipient_did, collections, seen_at_us) catch |err|
        return classify(CountResult, err);
    return .{ .found = count };
}

/// `{"seenAt": "<datetime>"}`: everything sorted at or before it reads as read.
pub fn updateSeen(
    allocator: std.mem.Allocator,
    store: ?NotificationStore,
    recipient_did: []const u8,
    body: []const u8,
) SeenResult {
    const Input = struct { seenAt: []const u8 };
    const input = std.json.parseFromSliceLeaky(Input, allocator, body, .{
        .ignore_unknown_fields = true,
    }) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    if (!validWatermark(input.seenAt)) return .invalid_request;
    const notifications = store orelse return .unavailable;
    _ = notifications.markSeen(recipient_did, input.seenAt) catch |err| return classify(SeenResult, err);
    return .updated;
}

/// An atproto datetime the watermark can hold: 1970 or later (before the
/// epoch nothing is unread anyway, and the column is non-negative).
fn validWatermark(value: []const u8) bool {
    if (!lexicon_value.validDatetime(value) or value.len < 4) return false;
    return std.mem.order(u8, value[0..4], "1970") != .lt;
}

fn datetime(allocator: std.mem.Allocator, us: i64) !?[]const u8 {
    if (us < 0 or us > last_renderable_us) return null;
    return try allocator.dupe(u8, &zat.Datetime.fromMicros(us).toString());
}

fn classify(comptime Result: type, err: NotificationStore.Error) Result {
    return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
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
            result.limit = query.parseDecimal(usize, pair.value) catch return error.InvalidQuery;
            if (result.limit < 1 or result.limit > max_limit) return error.InvalidQuery;
        } else if (std.mem.eql(u8, pair.name, "cursor")) {
            if (saw_cursor or pair.value.len == 0) return error.InvalidQuery;
            saw_cursor = true;
            result.cursor = pair.value;
        }
        // other parameters (Bluesky's `priority`, `reasons`, `seenAt`) are
        // accepted and ignored, so a generic notification client still works
    }
    return result;
}

// --- tests -----------------------------------------------------------------

const Fake = struct {
    items: []const store_module.Item,
    seen_at_us: ?i64 = null,
    marked: ?[]const u8 = null,
    last_request: ?store_module.ListRequest = null,
    fail: ?NotificationStore.Error = null,

    fn store(self: *Fake) NotificationStore {
        return .{
            .context = self,
            .list_fn = listFake,
            .count_unread_fn = countFake,
            .seen_at_fn = seenFake,
            .mark_seen_fn = markFake,
        };
    }

    fn listFake(context: *anyopaque, allocator: std.mem.Allocator, request: store_module.ListRequest) NotificationStore.Error![]store_module.Item {
        const self: *Fake = @ptrCast(@alignCast(context));
        if (self.fail) |err| return err;
        self.last_request = request;
        var out: std.ArrayList(store_module.Item) = .empty;
        for (self.items) |item| {
            if (request.before) |before| {
                const older = item.sort_at_us < before.created_at_us or
                    (item.sort_at_us == before.created_at_us and std.mem.order(u8, item.uri, before.at_uri) == .lt);
                if (!older) continue;
            }
            if (out.items.len == request.limit) break;
            try out.append(allocator, item);
        }
        return out.toOwnedSlice(allocator);
    }

    fn countFake(context: *anyopaque, _: []const u8, _: store_module.Collections, seen_at_us: ?i64) NotificationStore.Error!i64 {
        const self: *Fake = @ptrCast(@alignCast(context));
        var count: i64 = 0;
        for (self.items) |item| {
            if (seen_at_us == null or item.sort_at_us > seen_at_us.?) count += 1;
        }
        return count;
    }

    fn seenFake(context: *anyopaque, _: []const u8) NotificationStore.Error!?i64 {
        const self: *Fake = @ptrCast(@alignCast(context));
        if (self.fail) |err| return err;
        return self.seen_at_us;
    }

    fn markFake(context: *anyopaque, _: []const u8, seen_at: []const u8) NotificationStore.Error!i64 {
        const self: *Fake = @ptrCast(@alignCast(context));
        self.marked = seen_at;
        return 0;
    }
};

const test_collections: store_module.Collections = .{
    .track = "fm.plyr.dev.track",
    .like = "fm.plyr.dev.like",
    .profile = "fm.plyr.dev.actor.profile",
};

fn testItem(uri: []const u8, sort_at_us: i64) store_module.Item {
    return .{
        .reason = .like,
        .uri = uri,
        .cid = "bafyreicid",
        .author = .{ .did = "did:plc:fan", .handle = "fan.example", .display_name = "Fan", .avatar = null },
        .subject_uri = "at://did:plc:artist/fm.plyr.dev.track/song",
        .subject_title = "Song",
        .created_at = "2026-01-02T00:00:00Z",
        .sort_at_us = sort_at_us,
    };
}

test "notifications page newest first with a recipient-bound cursor and a read watermark" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const items = [_]store_module.Item{
        testItem("at://did:plc:fan/fm.plyr.dev.like/c", 3_000_000),
        testItem("at://did:plc:fan/fm.plyr.dev.like/b", 2_000_000),
        testItem("at://did:plc:fan/fm.plyr.dev.like/a", 1_000_000),
    };
    var fake: Fake = .{ .items = &items, .seen_at_us = 2_000_000 };

    const first = list(arena, fake.store(), "did:plc:artist", test_collections, "/xrpc/x?limit=2").found;
    try std.testing.expectEqual(@as(usize, 2), first.notifications.len);
    try std.testing.expectEqual(@as(usize, 3), fake.last_request.?.limit);
    try std.testing.expect(!first.notifications[0].isRead);
    try std.testing.expect(first.notifications[1].isRead);
    try std.testing.expectEqualStrings("like", first.notifications[0].reason);
    try std.testing.expectEqualStrings("1970-01-01T00:00:03.000000Z", first.notifications[0].indexedAt);
    try std.testing.expectEqualStrings("1970-01-01T00:00:02.000000Z", first.seenAt.?);

    const next_target = try std.fmt.allocPrint(arena, "/xrpc/x?limit=2&cursor={s}", .{first.cursor.?});
    const second = list(arena, fake.store(), "did:plc:artist", test_collections, next_target).found;
    try std.testing.expectEqual(@as(usize, 1), second.notifications.len);
    try std.testing.expectEqualStrings("at://did:plc:fan/fm.plyr.dev.like/a", second.notifications[0].uri);
    try std.testing.expect(second.cursor == null);

    // someone else's cursor is not a key to this inbox
    try std.testing.expectEqual(ListResult.invalid_request, list(arena, fake.store(), "did:plc:other", test_collections, next_target));
    try std.testing.expectEqual(ListResult.invalid_request, list(arena, fake.store(), "did:plc:artist", test_collections, "/xrpc/x?limit=0"));
    try std.testing.expectEqual(ListResult.invalid_request, list(arena, fake.store(), "did:plc:artist", test_collections, "/xrpc/x?limit=101"));
    try std.testing.expectEqual(ListResult.invalid_request, list(arena, fake.store(), "did:plc:artist", test_collections, "/xrpc/x?cursor=nope"));
    // generic clients send Bluesky's parameters; they are ignored
    try std.testing.expectEqual(@as(usize, 3), list(arena, fake.store(), "did:plc:artist", test_collections, "/xrpc/x?priority=false&reasons=like").found.notifications.len);

    var never_read: Fake = .{ .items = &items };
    const unread = list(arena, never_read.store(), "did:plc:artist", test_collections, "/xrpc/x").found;
    try std.testing.expect(unread.seenAt == null);
    for (unread.notifications) |notification| try std.testing.expect(!notification.isRead);

    try std.testing.expectEqual(@as(i64, 1), unreadCount(fake.store(), "did:plc:artist", test_collections).found);
    try std.testing.expectEqual(@as(i64, 3), unreadCount(never_read.store(), "did:plc:artist", test_collections).found);

    var down: Fake = .{ .items = &items, .fail = error.IndexUnavailable };
    try std.testing.expectEqual(ListResult.unavailable, list(arena, down.store(), "did:plc:artist", test_collections, "/xrpc/x"));
    try std.testing.expectEqual(ListResult.unavailable, list(arena, null, "did:plc:artist", test_collections, "/xrpc/x"));
}

test "updateSeen takes one datetime watermark" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    var fake: Fake = .{ .items = &.{} };
    try std.testing.expectEqual(SeenResult.updated, updateSeen(arena, fake.store(), "did:plc:artist", "{\"seenAt\":\"2026-01-02T03:04:05.678Z\",\"extra\":1}"));
    try std.testing.expectEqualStrings("2026-01-02T03:04:05.678Z", fake.marked.?);
    try std.testing.expectEqual(SeenResult.invalid_request, updateSeen(arena, fake.store(), "did:plc:artist", "{}"));
    try std.testing.expectEqual(SeenResult.invalid_request, updateSeen(arena, fake.store(), "did:plc:artist", "{\"seenAt\":\"yesterday\"}"));
    try std.testing.expectEqual(SeenResult.invalid_request, updateSeen(arena, fake.store(), "did:plc:artist", "{\"seenAt\":\"0001-01-01T00:00:00Z\"}"));
    try std.testing.expectEqual(SeenResult.invalid_request, updateSeen(arena, fake.store(), "did:plc:artist", "not json"));
}
