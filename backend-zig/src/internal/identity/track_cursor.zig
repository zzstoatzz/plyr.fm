//! Opaque, versioned cursor for the public track collection.
//!
//! The sort key is `(created_at, at_uri)`. The timestamp supplies feed order;
//! the canonical AT URI is the deterministic tie-breaker that the Python
//! timestamp-only cursor lacked.

const std = @import("std");
const zat = @import("zat");

pub const prefix = "trkcur_";
const version: u8 = 1;
const timestamp_bytes = @sizeOf(i64);
const header_bytes = 1 + timestamp_bytes;
const max_timestamp_us: i64 = 253_402_300_799_999_999;
const encoder = std.base64.url_safe_no_pad.Encoder;
const decoder = std.base64.url_safe_no_pad.Decoder;

pub const Cursor = struct {
    created_at_us: i64,
    at_uri: []const u8,
};

pub fn encode(allocator: std.mem.Allocator, cursor: Cursor) ![]const u8 {
    if (cursor.created_at_us < 0 or cursor.created_at_us > max_timestamp_us)
        return error.InvalidCursorTimestamp;
    try validateRecordUri(cursor.at_uri);

    const raw = try allocator.alloc(u8, header_bytes + cursor.at_uri.len);
    defer allocator.free(raw);
    raw[0] = version;
    std.mem.writeInt(i64, raw[1..header_bytes][0..timestamp_bytes], cursor.created_at_us, .big);
    @memcpy(raw[header_bytes..], cursor.at_uri);

    const output = try allocator.alloc(u8, prefix.len + encoder.calcSize(raw.len));
    @memcpy(output[0..prefix.len], prefix);
    _ = encoder.encode(output[prefix.len..], raw);
    return output;
}

/// Decode into caller-owned storage. `Cursor.at_uri` borrows from `storage`.
pub fn decode(storage: []u8, token: []const u8) !Cursor {
    if (!std.mem.startsWith(u8, token, prefix)) return error.InvalidCursor;
    const payload = token[prefix.len..];
    const raw_len = decoder.calcSizeForSlice(payload) catch return error.InvalidCursor;
    if (raw_len <= header_bytes or storage.len < raw_len) return error.InvalidCursor;
    decoder.decode(storage[0..raw_len], payload) catch return error.InvalidCursor;

    const raw = storage[0..raw_len];
    if (raw[0] != version) return error.UnsupportedCursorVersion;
    const created_at_us = std.mem.readInt(i64, raw[1..header_bytes][0..timestamp_bytes], .big);
    if (created_at_us < 0 or created_at_us > max_timestamp_us)
        return error.InvalidCursorTimestamp;
    const at_uri = raw[header_bytes..];
    try validateRecordUri(at_uri);
    return .{ .created_at_us = created_at_us, .at_uri = at_uri };
}

fn validateRecordUri(uri: []const u8) !void {
    const parsed = zat.AtUri.parse(uri) orelse return error.InvalidCursorUri;
    if (!parsed.hasRkey()) return error.InvalidCursorUri;
    if (zat.Did.parse(parsed.authority()) == null) return error.InvalidCursorUri;
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

    const allocator = std.testing.allocator;
    const raw = [_]u8{ 2, 0, 0, 0, 0, 0, 0, 0, 1 } ++ "at://did:plc:a/fm.plyr.track/r".*;
    const token = try allocator.alloc(u8, prefix.len + encoder.calcSize(raw.len));
    defer allocator.free(token);
    @memcpy(token[0..prefix.len], prefix);
    _ = encoder.encode(token[prefix.len..], &raw);
    try std.testing.expectError(error.UnsupportedCursorVersion, decode(&storage, token));
}
