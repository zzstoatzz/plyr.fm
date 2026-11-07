const std = @import("std");
const prefix = "tagcur_";
const header_bytes = 9;
const encoder = std.base64.url_safe_no_pad.Encoder;
const decoder = std.base64.url_safe_no_pad.Decoder;

pub const Cursor = struct { plays: i64, name: []const u8 };

pub fn encode(allocator: std.mem.Allocator, cursor: Cursor) ![]const u8 {
    if (cursor.plays < 0 or cursor.name.len == 0 or cursor.name.len > 200 or !std.unicode.utf8ValidateSlice(cursor.name)) return error.InvalidCursor;
    var raw: [209]u8 = undefined;
    raw[0] = 1;
    std.mem.writeInt(i64, raw[1..9], cursor.plays, .big);
    @memcpy(raw[header_bytes .. header_bytes + cursor.name.len], cursor.name);
    const output = try allocator.alloc(u8, prefix.len + encoder.calcSize(header_bytes + cursor.name.len));
    @memcpy(output[0..prefix.len], prefix);
    _ = encoder.encode(output[prefix.len..], raw[0 .. header_bytes + cursor.name.len]);
    return output;
}

pub fn decode(storage: []u8, token: []const u8) !Cursor {
    if (!std.mem.startsWith(u8, token, prefix) or token.len > 286) return error.InvalidCursor;
    const payload = token[prefix.len..];
    const size = decoder.calcSizeForSlice(payload) catch return error.InvalidCursor;
    if (size <= header_bytes or size > 209 or storage.len < size) return error.InvalidCursor;
    decoder.decode(storage[0..size], payload) catch return error.InvalidCursor;
    if (storage[0] != 1) return error.InvalidCursor;
    const plays = std.mem.readInt(i64, storage[1..9], .big);
    const name = storage[header_bytes..size];
    if (plays < 0 or !std.unicode.utf8ValidateSlice(name)) return error.InvalidCursor;
    return .{ .plays = plays, .name = name };
}

test "tag cursor round trips Unicode and rejects wrong cursor families" {
    const a = std.testing.allocator;
    const token = try encode(a, .{ .plays = 12, .name = "音楽" });
    defer a.free(token);
    var storage: [209]u8 = undefined;
    const actual = try decode(&storage, token);
    try std.testing.expectEqual(@as(i64, 12), actual.plays);
    try std.testing.expectEqualStrings("音楽", actual.name);
    try std.testing.expectError(error.InvalidCursor, decode(&storage, "trkcur_abc"));
    try std.testing.expectError(error.InvalidCursor, decode(&storage, "tagcur_!"));
}
