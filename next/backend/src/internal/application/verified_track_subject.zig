//! Resolve an opaque API id to an exact, repository-verified strong reference.

const std = @import("std");
const zat = @import("zat");
const track_id = @import("../identity/track_id.zig");
const TrackStore = @import("../index/track_store.zig").TrackStore;

pub const Subject = struct {
    uri: []const u8,
    cid: []const u8,
};

pub const Result = union(enum) {
    found: Subject,
    invalid_id,
    not_found,
    unverified,
    unavailable,
};

pub fn resolve(
    allocator: std.mem.Allocator,
    tracks: ?TrackStore,
    collection: []const u8,
    id: []const u8,
) Result {
    const decoded = allocator.alloc(u8, id.len) catch return .unavailable;
    const uri = track_id.decode(decoded, id) catch return .invalid_id;
    const parsed = zat.AtUri.parse(uri) orelse return .invalid_id;
    if (!std.mem.eql(u8, parsed.collection() orelse return .invalid_id, collection))
        return .not_found;
    const store = tracks orelse return .unavailable;
    const value = (store.getByUri(allocator, uri) catch |err| return switch (err) {
        error.CorruptProjection => Result.unverified,
        error.IndexUnavailable, error.OutOfMemory => Result.unavailable,
    }) orelse return .not_found;
    if (value.projection.verification != .verified_repo) return .unverified;
    const cid = value.record.cid orelse return .unverified;
    const parsed_cid = zat.Cid.fromString(allocator, cid) catch return .unverified;
    defer allocator.free(parsed_cid.raw);
    if (parsed_cid.codec() != zat.cbor.Codec.dag_cbor) return .unverified;
    return .{ .found = .{ .uri = value.record.uri, .cid = cid } };
}
