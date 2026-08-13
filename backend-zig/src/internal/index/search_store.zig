//! Read port for ranked references from the rebuildable search index.

const std = @import("std");
const domain = @import("../domain/search.zig");

pub const Types = packed struct {
    track: bool = true,
    artist: bool = true,
    album: bool = true,
    playlist: bool = true,
};

pub const Request = struct {
    query: []const u8,
    types: Types,
    limit: usize,
    track_collection: []const u8,
    list_collection: []const u8,
    profile_collection: []const u8,
};

pub const SearchStore = struct {
    context: *anyopaque,
    search_fn: *const fn (*anyopaque, std.mem.Allocator, Request) Error![]domain.Hit,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn search(
        self: SearchStore,
        allocator: std.mem.Allocator,
        request: Request,
    ) Error![]domain.Hit {
        return self.search_fn(self.context, allocator, request);
    }
};
