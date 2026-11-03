//! Walking `/v1/tracks` page by page must visit every track exactly once,
//! in index order, whatever the limit and however many tracks share a
//! timestamp. The store is a model of the keyset query in
//! `postgres_composed_track_store.zig`: order by (created_at, uri)
//! descending, resume strictly after the cursor.

const std = @import("std");
const hegel = @import("hegel");
const gen = @import("gen.zig");
const track = @import("../internal/domain/track.zig");
const list_tracks = @import("../internal/application/list_tracks.zig");
const store_module = @import("../internal/index/track_store.zig");
const query = @import("../internal/http/query.zig");

const collection = "fm.plyr.dev.track";

pub fn run() error{PropertyFailed}!void {
    try gen.runAll(.{
        .{ "pagination.tracks", walk },
        .{ "pagination.targets", targets },
    });
}

const ModelStore = struct {
    items: []store_module.ListItem,
    calls: usize = 0,
    last_limit: usize = 0,

    fn asStore(self: *ModelStore) store_module.TrackStore {
        return .{
            .context = self,
            .get_by_uri_fn = getOpaque,
            .list_public_fn = listOpaque,
            .ready_fn = readyOpaque,
        };
    }

    fn readyOpaque(_: *anyopaque) bool {
        return true;
    }

    fn getOpaque(_: *anyopaque, _: std.mem.Allocator, _: []const u8) store_module.TrackStore.Error!?track.Track {
        return null;
    }

    fn before(item: store_module.ListItem, created_at_us: i64, uri: []const u8) bool {
        if (item.created_at_us != created_at_us) return item.created_at_us < created_at_us;
        return std.mem.order(u8, item.value.record.uri, uri) == .lt;
    }

    fn listOpaque(
        context: *anyopaque,
        allocator: std.mem.Allocator,
        request: store_module.ListRequest,
    ) store_module.TrackStore.Error![]store_module.ListItem {
        const self: *ModelStore = @ptrCast(@alignCast(context));
        self.calls += 1;
        self.last_limit = request.limit;
        var out: std.ArrayList(store_module.ListItem) = .empty;
        for (self.items) |item| {
            if (out.items.len == request.limit) break;
            if (request.after) |after| if (!before(item, after.created_at_us, after.at_uri)) continue;
            try out.append(allocator, item);
        }
        return out.items;
    }
};

fn descending(_: void, x: store_module.ListItem, y: store_module.ListItem) bool {
    if (x.created_at_us != y.created_at_us) return x.created_at_us > y.created_at_us;
    return std.mem.order(u8, x.value.record.uri, y.value.record.uri) == .gt;
}

fn exampleTrack(uri: []const u8) track.Track {
    return .{
        .id = "trk_example",
        .record = .{ .uri = uri, .cid = null, .revision = null, .collection = collection, .rkey = "r" },
        .metadata = .{ .title = "t", .description = null, .album = null, .duration_seconds = null, .created_at = "2026-08-08T12:00:00.000000Z" },
        .artist = .{ .did = "did:plc:artist", .profile = .{ .handle = "artist.test", .display_name = "Artist", .avatar_url = null } },
        .media = .{ .artifacts = &.{}, .origins = &.{} },
        .access = .{ .visibility = .public, .in_discovery = true, .gate = null, .space_uri = null },
        .moderation = .{ .self_labels = &.{}, .operator_labels = &.{}, .override = null },
        .metrics = .{ .play_count = 0 },
        .projection = .{ .indexed_at = null, .verification = .legacy_unverified },
    };
}

fn walk(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();

    const n = try case.int(usize, 0, 40);
    var items: std.ArrayList(store_module.ListItem) = .empty;
    var seen: std.StringHashMapUnmanaged(void) = .empty;
    for (0..n) |_| {
        const rkey = try gen.string(case, a, "abcz234", 1, 3);
        const uri = try std.fmt.allocPrint(a, "at://did:plc:artist/{s}/{s}", .{ collection, rkey });
        if ((try seen.getOrPut(a, uri)).found_existing) continue;
        const created = try gen.pick(case, i64, &.{ 0, 1, 2, 1_786_196_523_123_456, 253_402_300_799_999_999 });
        try items.append(a, .{ .value = exampleTrack(uri), .created_at_us = created });
    }
    std.mem.sort(store_module.ListItem, items.items, {}, descending);
    var store: ModelStore = .{ .items = items.items };

    const limit = try case.int(usize, 1, 12);
    case.note("{d} tracks, limit {d}", .{ items.items.len, limit });
    var cursor: ?[]const u8 = null;
    var visited: usize = 0;
    var pages: usize = 0;
    while (true) {
        const target = if (cursor) |c|
            try std.fmt.allocPrint(a, "/v1/tracks?limit={d}&cursor={s}", .{ limit, c })
        else
            try std.fmt.allocPrint(a, "/v1/tracks?limit={d}", .{limit});
        const page = switch (list_tracks.execute(a, store.asStore(), collection, target)) {
            .found => |page| page,
            else => |other| {
                case.note("page {d}: {s}", .{ pages, @tagName(other) });
                return case.fail("a cursor the server issued is refused");
            },
        };
        pages += 1;
        if (store.last_limit != limit + 1) return case.fail("store not asked for one row past the page");
        if (page.data.len > limit) return case.fail("page larger than the limit");
        for (page.data) |item| {
            if (visited >= items.items.len) return case.fail("walk returns more tracks than exist");
            if (!std.mem.eql(u8, item.record.uri, items.items[visited].value.record.uri))
                return case.fail("walk skips, repeats, or reorders a track");
            visited += 1;
        }
        if (page.has_more and page.next_cursor == null) return case.fail("has_more without a cursor");
        if (!page.has_more and page.next_cursor != null) return case.fail("a cursor on the last page");
        if (page.has_more and page.data.len != limit) return case.fail("a short page claims more");
        cursor = page.next_cursor orelse break;
        if (pages > items.items.len + 1) return case.fail("walk does not terminate");
    }
    if (visited != items.items.len) return case.fail("walk ends before the last track");
    if (pages > 1) case.event("more than one page");
    if (items.items.len > 1 and items.items[0].created_at_us == items.items[1].created_at_us) case.event("timestamp tie");
}

/// any request target must yield a response, never a crash, and a refused
/// request must not reach the store
fn targets(_: void, case: *hegel.TestCase) !void {
    var debug: gen.Debug = .init;
    defer gen.noLeaks(&debug);
    var arena = std.heap.ArenaAllocator.init(debug.allocator());
    defer arena.deinit();
    const a = arena.allocator();
    var target: std.ArrayList(u8) = .empty;
    try target.appendSlice(a, "/v1/tracks");
    const names = [_][]const u8{ "limit", "limit", "cursor", "artist_did", "x", "" };
    const values = [_][]const u8{ "1", "50", "100", "0", "101", "+1", "1_0", "%31", "%2B1", "-1", "", "did:plc:artist", "did%3Aplc%3Aartist", "not-a-did", "trkcur_AQAAAAAAAAAA" };
    for (0..try case.int(usize, 0, 3)) |i| {
        try target.append(a, if (i == 0) '?' else '&');
        try target.print(a, "{s}={s}", .{ try gen.pick(case, []const u8, &names), try gen.pick(case, []const u8, &values) });
    }
    case.note("GET {s}", .{target.items});
    var store: ModelStore = .{ .items = &.{} };
    const result = list_tracks.execute(a, store.asStore(), collection, target.items);
    switch (result) {
        .found => {
            case.event("found");
            if (store.last_limit < 2 or store.last_limit > list_tracks.max_limit + 1)
                return case.fail("limit outside 1..max reached the store");
            var pairs = query.Iterator.init(a, target.items);
            while (pairs.next() catch null) |pair| {
                if (!std.mem.eql(u8, pair.name, "limit")) continue;
                for (pair.value) |c| if (!std.ascii.isDigit(c))
                    return case.fail("limit accepts a value that is not decimal digits");
            }
        },
        .invalid_request => if (store.calls != 0) return case.fail("a refused request reached the store"),
        else => return case.fail("unexpected result for an empty store"),
    }
}
