//! Versioned record cursor bound to an exact query scope.
//!
//! A cursor from a global collection must not be reusable in an owner-filtered
//! collection merely because its last record happens to share that owner.

const std = @import("std");
const zat = @import("zat");

const version: u8 = 1;
const timestamp_bytes = @sizeOf(i64);
const scope_length_bytes = @sizeOf(u16);
const header_bytes = 1 + timestamp_bytes + scope_length_bytes;
const max_timestamp_us: i64 = 253_402_300_799_999_999;
const encoder = std.base64.url_safe_no_pad.Encoder;
const decoder = std.base64.url_safe_no_pad.Decoder;

pub const Cursor = struct {
    created_at_us: i64,
    at_uri: []const u8,
};

pub fn encode(
    allocator: std.mem.Allocator,
    prefix: []const u8,
    scope: []const u8,
    cursor: Cursor,
) ![]const u8 {
    if (scope.len == 0 or scope.len > std.math.maxInt(u16)) return error.InvalidCursorScope;
    if (cursor.created_at_us < 0 or cursor.created_at_us > max_timestamp_us)
        return error.InvalidCursorTimestamp;
    try validateRecordUri(cursor.at_uri);
    const raw = try allocator.alloc(u8, header_bytes + scope.len + cursor.at_uri.len);
    defer allocator.free(raw);
    raw[0] = version;
    std.mem.writeInt(i64, raw[1 .. 1 + timestamp_bytes][0..timestamp_bytes], cursor.created_at_us, .big);
    std.mem.writeInt(
        u16,
        raw[1 + timestamp_bytes .. header_bytes][0..scope_length_bytes],
        @intCast(scope.len),
        .big,
    );
    @memcpy(raw[header_bytes .. header_bytes + scope.len], scope);
    @memcpy(raw[header_bytes + scope.len ..], cursor.at_uri);

    const output = try allocator.alloc(u8, prefix.len + encoder.calcSize(raw.len));
    @memcpy(output[0..prefix.len], prefix);
    _ = encoder.encode(output[prefix.len..], raw);
    return output;
}

pub fn decode(
    storage: []u8,
    prefix: []const u8,
    expected_scope: []const u8,
    token: []const u8,
) !Cursor {
    if (!std.mem.startsWith(u8, token, prefix)) return error.InvalidCursor;
    const payload = token[prefix.len..];
    const raw_len = decoder.calcSizeForSlice(payload) catch return error.InvalidCursor;
    if (raw_len <= header_bytes or storage.len < raw_len) return error.InvalidCursor;
    decoder.decode(storage[0..raw_len], payload) catch return error.InvalidCursor;
    const raw = storage[0..raw_len];
    if (raw[0] != version) return error.UnsupportedCursorVersion;
    const created_at_us = std.mem.readInt(i64, raw[1 .. 1 + timestamp_bytes][0..timestamp_bytes], .big);
    if (created_at_us < 0 or created_at_us > max_timestamp_us)
        return error.InvalidCursorTimestamp;
    const scope_len = std.mem.readInt(
        u16,
        raw[1 + timestamp_bytes .. header_bytes][0..scope_length_bytes],
        .big,
    );
    if (scope_len == 0 or header_bytes + scope_len >= raw.len) return error.InvalidCursor;
    const scope = raw[header_bytes .. header_bytes + scope_len];
    if (!std.mem.eql(u8, scope, expected_scope)) return error.CursorScopeMismatch;
    const at_uri = raw[header_bytes + scope_len ..];
    try validateRecordUri(at_uri);
    return .{ .created_at_us = created_at_us, .at_uri = at_uri };
}

fn validateRecordUri(uri: []const u8) !void {
    const parsed = zat.AtUri.parse(uri) orelse return error.InvalidCursorUri;
    if (!parsed.hasRkey() or zat.Did.parse(parsed.authority()) == null)
        return error.InvalidCursorUri;
}

test "scoped cursors reject cross-scope replay" {
    const allocator = std.testing.allocator;
    const cursor: Cursor = .{
        .created_at_us = 42,
        .at_uri = "at://did:plc:owner/fm.plyr.dev.list/playlist",
    };
    const token = try encode(allocator, "plscur_", "owner:did:plc:owner", cursor);
    defer allocator.free(token);
    const storage = try allocator.alloc(u8, token.len);
    defer allocator.free(storage);
    const decoded = try decode(storage, "plscur_", "owner:did:plc:owner", token);
    try std.testing.expectEqualStrings(cursor.at_uri, decoded.at_uri);
    try std.testing.expectError(
        error.CursorScopeMismatch,
        decode(storage, "plscur_", "global", token),
    );
}
