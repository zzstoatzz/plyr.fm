//! Opaque, versioned cursor for the public track collection.
//!
//! The sort key is `(created_at, at_uri)`. The timestamp supplies feed order;
//! the canonical AT URI is the deterministic tie-breaker that the Python
//! timestamp-only cursor lacked.

const std = @import("std");
const record_cursor = @import("record_cursor.zig");

pub const prefix = "trkcur_";
pub const Cursor = record_cursor.Cursor;

pub fn encode(allocator: std.mem.Allocator, cursor: Cursor) ![]const u8 {
    return record_cursor.encode(allocator, prefix, cursor);
}

/// Decode into caller-owned storage. `Cursor.at_uri` borrows from `storage`.
pub fn decode(storage: []u8, token: []const u8) !Cursor {
    return record_cursor.decode(storage, prefix, token);
}

test "track collection cursors preserve the complete stable sort key" {
    const allocator = std.testing.allocator;
    const expected: Cursor = .{
        .created_at_us = 1_786_196_523_123_456,
        .at_uri = "at://did:plc:artist/fm.plyr.dev.track/3m123abc",
    };
    const encoded = try encode(allocator, expected);
    defer allocator.free(encoded);
    try std.testing.expect(std.mem.startsWith(u8, encoded, prefix));
    try std.testing.expect(std.mem.indexOfAny(u8, encoded, "/+=") == null);

    const storage = try allocator.alloc(u8, encoded.len);
    defer allocator.free(storage);
    const actual = try decode(storage, encoded);
    try std.testing.expectEqual(expected.created_at_us, actual.created_at_us);
    try std.testing.expectEqualStrings(expected.at_uri, actual.at_uri);
}

test "track collection cursors reject other tokens and versions" {
    var storage: [256]u8 = undefined;
    try std.testing.expectError(error.InvalidCursor, decode(&storage, "cursor_abc"));
}
