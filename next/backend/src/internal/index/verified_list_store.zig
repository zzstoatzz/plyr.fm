//! Read port for source-authenticated list summaries and ordered detail.

const std = @import("std");
const verified_list = @import("../domain/verified_list.zig");
const scoped_record_cursor = @import("../identity/scoped_record_cursor.zig");

pub const CollectionRequest = struct {
    collection: []const u8,
    profile_collection: []const u8,
    kind: verified_list.Kind,
    owner_did: ?[]const u8,
    limit: usize,
    after: ?scoped_record_cursor.Cursor,
};

pub const DetailRequest = struct {
    uri: []const u8,
    list_collection: []const u8,
    track_collection: []const u8,
    profile_collection: []const u8,
    kind: verified_list.Kind,
};

pub const CollectionItem = struct {
    value: verified_list.Summary,
    created_at_us: i64,
};

pub const VerifiedListStore = struct {
    context: *anyopaque,
    list_by_owner_fn: *const fn (
        *anyopaque,
        std.mem.Allocator,
        CollectionRequest,
    ) Error![]CollectionItem,
    get_by_uri_fn: *const fn (
        *anyopaque,
        std.mem.Allocator,
        DetailRequest,
    ) Error!?verified_list.Detail,

    pub const Error = error{
        IndexUnavailable,
        CorruptProjection,
        OutOfMemory,
    };

    pub fn listByOwner(
        self: VerifiedListStore,
        allocator: std.mem.Allocator,
        request: CollectionRequest,
    ) Error![]CollectionItem {
        return self.list_by_owner_fn(self.context, allocator, request);
    }

    pub fn getByUri(
        self: VerifiedListStore,
        allocator: std.mem.Allocator,
        request: DetailRequest,
    ) Error!?verified_list.Detail {
        return self.get_by_uri_fn(self.context, allocator, request);
    }
};
