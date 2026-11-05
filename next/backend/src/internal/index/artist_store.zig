const std = @import("std");
const artist = @import("../domain/artist.zig");

pub const Identifier = union(enum) {
    did: []const u8,
    handle: []const u8,
};

pub const Summary = struct {
    did: []const u8,
    handle: []const u8,
    display_name: []const u8,
    avatar_url: ?[]const u8,
    track_count: i64,
};

pub const ArtistStore = struct {
    context: *anyopaque,
    get_fn: *const fn (*anyopaque, std.mem.Allocator, Identifier) Error!?artist.Artist,

    resolve_fn: ?*const fn (*anyopaque, std.mem.Allocator, []const []const u8, []const u8) Error![]const Summary = null,

    pub fn resolve(self: ArtistStore, allocator: std.mem.Allocator, dids: []const []const u8, collection: []const u8) Error![]const Summary {
        const resolve_fn = self.resolve_fn orelse return error.IndexUnavailable;
        return resolve_fn(self.context, allocator, dids, collection);
    }

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn get(
        self: ArtistStore,
        allocator: std.mem.Allocator,
        identifier: Identifier,
    ) Error!?artist.Artist {
        return self.get_fn(self.context, allocator, identifier);
    }
};
