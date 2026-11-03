const std = @import("std");
const query = @import("../http/query.zig");
const domain = @import("../domain/search.zig");
const store_module = @import("../index/search_store.zig");
const SearchStore = store_module.SearchStore;

pub const default_limit: usize = 20;
pub const max_limit: usize = 50;
pub const min_query_codepoints: usize = 2;
pub const max_query_codepoints: usize = 100;
pub const max_query_bytes: usize = 400;

const Options = struct {
    q: ?[]const u8 = null,
    types: store_module.Types = .{},
    limit: usize = default_limit,
};

pub const Result = union(enum) {
    found: domain.Page,
    invalid_request,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?SearchStore,
    track_collection: []const u8,
    list_collection: []const u8,
    profile_collection: []const u8,
    target: []const u8,
) Result {
    const options = parseOptions(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const raw = options.q orelse return .invalid_request;
    const search_query = std.mem.trim(u8, raw, " \t\r\n");
    if (!validQuery(search_query)) return .invalid_request;

    const configured = store orelse return .unavailable;
    const hits = configured.search(allocator, .{
        .query = search_query,
        .types = options.types,
        .limit = options.limit,
        .track_collection = track_collection,
        .list_collection = list_collection,
        .profile_collection = profile_collection,
    }) catch |err| return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
    if (hits.len > options.limit) return .internal_error;

    var counts: domain.Counts = .{};
    for (hits) |hit| switch (hit.type) {
        .track => counts.tracks += 1,
        .artist => counts.artists += 1,
        .album => counts.albums += 1,
        .playlist => counts.playlists += 1,
    };
    return .{ .found = .{
        .data = hits,
        .query = search_query,
        .counts = counts,
    } };
}

fn parseOptions(allocator: std.mem.Allocator, target: []const u8) !Options {
    var result: Options = .{};
    var saw_q = false;
    var saw_types = false;
    var saw_limit = false;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "q")) {
            if (saw_q) return error.InvalidQuery;
            saw_q = true;
            result.q = pair.value;
        } else if (std.mem.eql(u8, pair.name, "types")) {
            if (saw_types or pair.value.len == 0) return error.InvalidQuery;
            saw_types = true;
            result.types = try parseTypes(pair.value);
        } else if (std.mem.eql(u8, pair.name, "limit")) {
            if (saw_limit or pair.value.len == 0) return error.InvalidQuery;
            saw_limit = true;
            const parsed = std.fmt.parseInt(usize, pair.value, 10) catch
                return error.InvalidQuery;
            if (parsed < 1 or parsed > max_limit) return error.InvalidQuery;
            result.limit = parsed;
        } else return error.InvalidQuery;
    }
    return result;
}

fn parseTypes(value: []const u8) !store_module.Types {
    var result: store_module.Types = .{
        .track = false,
        .artist = false,
        .album = false,
        .playlist = false,
    };
    var any = false;
    var values = std.mem.splitScalar(u8, value, ',');
    while (values.next()) |item| {
        if (item.len == 0) return error.InvalidQuery;
        if (std.mem.eql(u8, item, "track")) {
            if (result.track) return error.InvalidQuery;
            result.track = true;
        } else if (std.mem.eql(u8, item, "artist")) {
            if (result.artist) return error.InvalidQuery;
            result.artist = true;
        } else if (std.mem.eql(u8, item, "album")) {
            if (result.album) return error.InvalidQuery;
            result.album = true;
        } else if (std.mem.eql(u8, item, "playlist")) {
            if (result.playlist) return error.InvalidQuery;
            result.playlist = true;
        } else return error.InvalidQuery;
        any = true;
    }
    if (!any) return error.InvalidQuery;
    return result;
}

fn validQuery(value: []const u8) bool {
    if (value.len == 0 or value.len > max_query_bytes) return false;
    const view = std.unicode.Utf8View.init(value) catch return false;
    var iterator = view.iterator();
    var count: usize = 0;
    while (iterator.nextCodepointSlice() != null) {
        count += 1;
        if (count > max_query_codepoints) return false;
    }
    return count >= min_query_codepoints;
}

test "search parses one strict bounded query and type set" {
    const Fake = struct {
        saw_expected_query: bool = false,
        saw_expected_types: bool = false,
        saw_expected_limit: bool = false,

        fn store(self: *@This()) SearchStore {
            return .{ .context = self, .search_fn = search };
        }
        fn search(
            context: *anyopaque,
            _: std.mem.Allocator,
            request: store_module.Request,
        ) SearchStore.Error![]domain.Hit {
            const self: *@This() = @ptrCast(@alignCast(context));
            self.saw_expected_query = std.mem.eql(u8, "plyr", request.query);
            self.saw_expected_types = !request.types.track and request.types.artist and
                request.types.album and !request.types.playlist;
            self.saw_expected_limit = request.limit == 7;
            return &.{};
        }
    };
    var fake: Fake = .{};
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const result = execute(
        arena.allocator(),
        fake.store(),
        "fm.plyr.dev.track",
        "fm.plyr.dev.list",
        "fm.plyr.dev.actor.profile",
        "/v1/search?q=+plyr+&types=artist%2Calbum&limit=7",
    );
    try std.testing.expectEqual(@as(usize, 0), result.found.data.len);
    try std.testing.expectEqualStrings("plyr", result.found.query);
    try std.testing.expect(fake.saw_expected_query);
    try std.testing.expect(fake.saw_expected_types);
    try std.testing.expect(fake.saw_expected_limit);
}

test "search rejects ambiguous, malformed, and unsupported options" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const targets = [_][]const u8{
        "/v1/search",
        "/v1/search?q=a",
        "/v1/search?q=ok&q=again",
        "/v1/search?q=okay&limit=0",
        "/v1/search?q=okay&limit=51",
        "/v1/search?q=okay&types=track,track",
        "/v1/search?q=okay&types=tags",
        "/v1/search?q=%FF",
        "/v1/search?q=okay&cursor=nope",
    };
    for (targets) |target| {
        try std.testing.expectEqual(
            Result.invalid_request,
            execute(
                arena.allocator(),
                null,
                "fm.plyr.dev.track",
                "fm.plyr.dev.list",
                "fm.plyr.dev.actor.profile",
                target,
            ),
        );
    }
}
