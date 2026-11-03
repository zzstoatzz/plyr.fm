const std = @import("std");
const artist = @import("../domain/artist.zig");

pub const Identifier = union(enum) {
    did: []const u8,
    handle: []const u8,
};

pub const ArtistStore = struct {
    context: *anyopaque,
    get_fn: *const fn (*anyopaque, std.mem.Allocator, Identifier) Error!?artist.Artist,

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
