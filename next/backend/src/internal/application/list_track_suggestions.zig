const std = @import("std");
const track_suggestions = @import("../domain/track_suggestions.zig");
const query = @import("../http/query.zig");
const store_module = @import("../index/track_suggestion_store.zig");
const TrackSuggestionStore = store_module.TrackSuggestionStore;

pub const default_limit: usize = 12;
pub const max_limit: usize = 24;
pub const max_seeds: usize = 20;
pub const max_exclude: usize = 60;
const max_uri_bytes: usize = 512;

pub const Options = struct {
    limit: usize = default_limit,
    seeds: []const []const u8 = &.{},
    exclude: []const []const u8 = &.{},
};

pub const Result = union(enum) {
    found: track_suggestions.Suggestions,
    invalid_request,
    internal_error,
    unavailable,
};

pub const Collections = struct {
    track: []const u8,
    profile: []const u8,
    like: []const u8,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?TrackSuggestionStore,
    collections: Collections,
    target: []const u8,
) Result {
    const options = parseOptions(allocator, target) catch |err| return switch (err) {
        error.OutOfMemory => .unavailable,
        else => .invalid_request,
    };
    const configured_store = store orelse return .unavailable;
    const tracks = configured_store.list(allocator, .{
        .track_collection = collections.track,
        .profile_collection = collections.profile,
        .like_collection = collections.like,
        .seeds = options.seeds,
        .exclude = options.exclude,
        .limit = options.limit,
    }) catch |err| return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
    if (tracks.len > options.limit) return .internal_error;
    return .{ .found = .{ .data = tracks } };
}

fn parseOptions(allocator: std.mem.Allocator, target: []const u8) !Options {
    var options: Options = .{};
    var saw_limit = false;
    var seeds: std.ArrayList([]const u8) = .empty;
    var exclude: std.ArrayList([]const u8) = .empty;
    var pairs = query.Iterator.init(allocator, target);
    while (try pairs.next()) |pair| {
        if (std.mem.eql(u8, pair.name, "limit")) {
            if (saw_limit or pair.value.len == 0) return error.InvalidQuery;
            saw_limit = true;
            options.limit = query.parseDecimal(usize, pair.value) catch return error.InvalidQuery;
            if (options.limit < 1 or options.limit > max_limit) return error.InvalidQuery;
        } else if (std.mem.eql(u8, pair.name, "seed")) {
            try appendUri(allocator, &seeds, pair.value, max_seeds);
        } else if (std.mem.eql(u8, pair.name, "exclude")) {
            try appendUri(allocator, &exclude, pair.value, max_exclude);
        } else return error.InvalidQuery;
    }
    if (seeds.items.len == 0) return error.InvalidQuery;
    options.seeds = seeds.items;
    options.exclude = exclude.items;
    return options;
}

fn appendUri(allocator: std.mem.Allocator, list: *std.ArrayList([]const u8), value: []const u8, max: usize) !void {
    if (value.len == 0 or value.len > max_uri_bytes or !std.mem.startsWith(u8, value, "at://") or
        std.mem.indexOfScalar(u8, value, 0) != null or !std.unicode.utf8ValidateSlice(value))
        return error.InvalidQuery;
    for (list.items) |existing| if (std.mem.eql(u8, existing, value)) return;
    if (list.items.len == max) return error.InvalidQuery;
    try list.append(allocator, value);
}

test "suggestion query needs a seed and bounds every list" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();
    const a = arena.allocator();
    const uri = "at://did:plc:a/fm.plyr.track/1";
    const parsed = try parseOptions(a, "/v1/suggestions/tracks?seed=" ++ uri ++ "&seed=" ++ uri ++ "&exclude=" ++ uri ++ "&limit=5");
    try std.testing.expectEqual(@as(usize, 1), parsed.seeds.len);
    try std.testing.expectEqual(@as(usize, 1), parsed.exclude.len);
    try std.testing.expectEqual(@as(usize, 5), parsed.limit);
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/suggestions/tracks"));
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/suggestions/tracks?seed=https://x"));
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/suggestions/tracks?seed=" ++ uri ++ "&limit=25"));
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, "/v1/suggestions/tracks?seed=" ++ uri ++ "&other=1"));
    var many: std.ArrayList(u8) = .empty;
    try many.appendSlice(a, "/v1/suggestions/tracks?");
    for (0..max_seeds + 1) |index| try many.print(a, "seed=at://did:plc:a/fm.plyr.track/{d}&", .{index});
    try std.testing.expectError(error.InvalidQuery, parseOptions(a, many.items[0 .. many.items.len - 1]));
}
