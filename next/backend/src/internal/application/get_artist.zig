const std = @import("std");
const zat = @import("zat");
const artist = @import("../domain/artist.zig");
const artist_index = @import("../index/artist_store.zig");
const ArtistStore = artist_index.ArtistStore;

pub const Result = union(enum) {
    found: artist.Artist,
    invalid_identifier,
    not_found,
    internal_error,
    unavailable,
};

pub fn execute(
    allocator: std.mem.Allocator,
    store: ?ArtistStore,
    raw_identifier: []const u8,
) Result {
    const identifier: artist_index.Identifier = if (zat.Did.parse(raw_identifier) != null)
        .{ .did = raw_identifier }
    else if (zat.Handle.parse(raw_identifier) != null)
        .{ .handle = asciiLower(allocator, raw_identifier) catch return .unavailable }
    else
        return .invalid_identifier;

    const configured_store = store orelse return .unavailable;
    const value = configured_store.get(allocator, identifier) catch |err| {
        switch (err) {
            error.CorruptProjection => std.log.err("corrupt artist projection for {s}", .{raw_identifier}),
            error.IndexUnavailable => std.log.err("artist index unavailable for {s}", .{raw_identifier}),
            error.OutOfMemory => {},
        }
        return classifyStoreError(err);
    };
    return if (value) |found| .{ .found = found } else .not_found;
}

fn asciiLower(allocator: std.mem.Allocator, input: []const u8) ![]const u8 {
    const output = try allocator.alloc(u8, input.len);
    for (input, output) |byte, *destination| destination.* = std.ascii.toLower(byte);
    return output;
}

fn classifyStoreError(err: ArtistStore.Error) Result {
    return switch (err) {
        error.CorruptProjection => .internal_error,
        error.IndexUnavailable, error.OutOfMemory => .unavailable,
    };
}

const FakeStore = struct {
    expected: artist_index.Identifier,

    fn asStore(self: *FakeStore) ArtistStore {
        return .{ .context = self, .get_fn = getOpaque };
    }

    fn getOpaque(
        context: *anyopaque,
        _: std.mem.Allocator,
        actual: artist_index.Identifier,
    ) ArtistStore.Error!?artist.Artist {
        const self: *FakeStore = @ptrCast(@alignCast(context));
        switch (self.expected) {
            .did => |expected| switch (actual) {
                .did => |value| if (!std.mem.eql(u8, expected, value)) return error.CorruptProjection,
                .handle => return error.CorruptProjection,
            },
            .handle => |expected| switch (actual) {
                .handle => |value| if (!std.mem.eql(u8, expected, value)) return error.CorruptProjection,
                .did => return error.CorruptProjection,
            },
        }
        return null;
    }
};

test "artist lookup accepts canonical DIDs and case-normalized handles" {
    var arena = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    var did_store = FakeStore{ .expected = .{ .did = "did:plc:artist" } };
    try std.testing.expectEqual(
        Result.not_found,
        execute(arena.allocator(), did_store.asStore(), "did:plc:artist"),
    );

    var handle_store = FakeStore{ .expected = .{ .handle = "artist.example" } };
    try std.testing.expectEqual(
        Result.not_found,
        execute(arena.allocator(), handle_store.asStore(), "Artist.Example"),
    );
    try std.testing.expectEqual(
        Result.invalid_identifier,
        execute(arena.allocator(), handle_store.asStore(), "not-an-atproto-identifier"),
    );
}

test "artist store failures keep corruption distinct from availability" {
    try std.testing.expectEqual(Result.internal_error, classifyStoreError(error.CorruptProjection));
    try std.testing.expectEqual(Result.unavailable, classifyStoreError(error.IndexUnavailable));
    try std.testing.expectEqual(Result.unavailable, classifyStoreError(error.OutOfMemory));
}
